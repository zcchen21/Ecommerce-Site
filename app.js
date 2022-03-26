"use strict";

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

console.log(stripePublishableKey, stripeSecretKey);

const express = require("express");
const multer = require("multer");
const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(stripeSecretKey);

const bcrypt = require("bcrypt");

const app = express();

app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use(multer().none());
app.use(cookieParser());

app.get("/stripe/key", async function(req, res) {
  try {
    res.json({"publishableKey": stripePublishableKey});
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

app.post("/item/checkout", async function(req, res) {
  try {
    let currentUser = req.cookies.username;
    if (currentUser === undefined) {
      res.type("text");
      res.status(400).send("User not logged in");
    } else {
      let db = await getDBConnection();
      let productId = req.body.product_id;
      console.log(productId);
      let productAvailabilityQry = "SELECT name, availability, capacity FROM products \
                                    WHERE product_id=?";
      let productAvailabilityInfo = await db.get(productAvailabilityQry, [productId]);
      console.log(productAvailabilityInfo);
      if (parseInt(productAvailabilityInfo.capacity) > 0) {
        let purchaseInfoQry = "SELECT name, price, descriptions FROM products WHERE product_id=?";
        let purchaseInfo = await db.get(purchaseInfoQry, [productId]);
        console.log(purchaseInfo);
        await db.close();
        let session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: purchaseInfo.name,
                },
                unit_amount: purchaseInfo.price * 100,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `http://localhost:8000/index.html`,
          cancel_url: `http://localhost:8000/index.html`,
        });
        console.log("finished");
        res.json({url: session.url});
      }
    }
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

app.post("/cart/checkout", async function(req, res) {
  try {
    console.log("hi");
    let currentUser = req.cookies.username;
    if (currentUser === undefined) {
      res.type("text");
      res.status(400).send("User not logged in");
    } else {
      let items = new Map();
      let db = await getDBConnection();
      let cart = req.body.cart;
      console.log(cart.length);
      for (let i = 0; i < cart.length; i++) {
        let productId = req.body.cart[i];
        console.log(productId);
        let productAvailabilityQry = "SELECT name, availability, capacity FROM products \
                                      WHERE product_id=?";
        let productAvailabilityInfo = await db.get(productAvailabilityQry, [productId]);
        console.log(productAvailabilityInfo);
        if (parseInt(productAvailabilityInfo.capacity) > 0) {
          let purchaseInfoQry = "SELECT name, price, descriptions FROM products WHERE product_id=?";
          let purchaseInfo = await db.get(purchaseInfoQry, [productId]);
          console.log(purchaseInfo);
        items.set(productId, [purchaseInfo["name"], purchaseInfo["price"]]);
        console.log(items.size);
      }
      await db.close();
      let session = await stripe.checkout.sessions.create({
        line_items: cart.map(product => {
          let info = items.get(product);
          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: info[0],
              },
              unit_amount: info[1] * 100,
            },
            quantity: 1,
          }
        }),
        mode: 'payment',
        success_url: `http://localhost:8000/index.html`,
        cancel_url: `http://localhost:8000/index.html`,
      });
        res.json({url: session.url});
      }
    }
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * If the search parameter is included, returns the product data that matched
 * the search term. If not, returns all the product data. Returns in JSON format.
 */
app.get("/products", async function(req, res) {
  res.clearCookie("username");
  try {
    let db = await getDBConnection();
    let search = req.query.search;
    let rows = await getProducts(search, db);
    await db.close();
    res.json(rows);
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * When users click a category in the navigation bar, return the same
 * category with json form in the database.
 */
app.get("/filters/:category", async function(req, res) {
  try {
    let db = await getDBConnection();
    let category = req.params.category;
    let qry = "SELECT product_id FROM products WHERE category=?";
    let rows = await db.all(qry, [category]);
    await db.close();
    res.json(rows);
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * After input, the username and password will be verified in database.
 * if verification is pass, a cookie will be generated.
 */
app.post("/login", async function(req, res) {
  res.type("text");
  try {
    let db = await getDBConnection();
    let username = req.body.username;
    let password = req.body.password;
    if (!(username && password)) {
      res.status(400).send("Missing one or more of the required params.");
    }
    let info = await db.get("SELECT password FROM users WHERE username=?;", [username]);
    if (info) {
      let validPassword = await bcrypt.compare(password, info.password);
      if (validPassword) {
        res.cookie("username", username);
        await db.close();
        res.send("Logged in successfully!");
      } else {
        res.send("Username and password does not match.");
      }
    } else {
      res.status(400).send("Username does not exist.");
    }
  } catch (error) {
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * After logging out the username will be cleared and
 * send message to let users to know that they log out successfully.
 */
app.post("/logout", async function(req, res) {
  res.type("text");
  try {
    res.clearCookie("username");
    res.send("Logged out successfully!");
  } catch (error) {
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * Returns the detail of a selected product in JSON format.
 */
app.get("/products/:productId", async function(req, res) {
  try {
    let db = await getDBConnection();
    let productId = req.params.productId;
    let infoQry = "SELECT name, price, descriptions, availability \
                   FROM products \
                   WHERE product_id = ?;";
    let info = await db.get(infoQry, [productId]);
    let avgRatingQry = "SELECT AVG(rating) rating FROM reviews WHERE product_id=?";
    let avgRating = await db.get(avgRatingQry, [productId]);
    await db.close();
    res.json({"name": info.name,
      "price": info.price,
      "descriptions": info.descriptions,
      "availability": info.availability,
      "rating": avgRating.rating});
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * After logging in, if the user is in the database and the product is in stock
 * the user can buy the product. Otherwise, user hasn't log in or the product is
 * out of stock
 */
app.post("/buy", async function(req, res) {
  try {
    let currentUser = req.cookies.username;
    if (currentUser === undefined) {
      res.type("text");
      res.status(400).send("User not logged in");
    } else {
      let db = await getDBConnection();
      let productId = req.body.productId;
      let productAvailabilityQry = "SELECT name, availability, capacity FROM products \
                                    WHERE product_id=?";
      let productAvailabilityInfo = await db.get(productAvailabilityQry, [productId]);
      if (parseInt(productAvailabilityInfo.capacity) > 0) {
        let purchaseInfoQry = "SELECT name, price, descriptions FROM products WHERE product_id=?";
        let purchaseInfo = await db.get(purchaseInfoQry, [productId]);
        await db.close();

        let session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: purchaseInfo.name,
                },
                unit_amount: purchaseInfo.price * 100,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `http://localhost:8000/success.html`,
          cancel_url: `http://localhost:8000/cancel.html`,
        });

        res.redirect(303, session.url);

        // res.json(purchaseInfo);
      } else if (parseInt(productAvailabilityInfo.capacity) === 0) {
        res.type("text");
        res.status(400).send("This item is out of stock.");
      }
    }
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * When the user choose products to buy, he/she has to fill out credit card number
 * and security code. Verify the two info's accuracy.
 * Check current capacity. If capcity > 0, the user can confirm to buy.
 * capacity = capacity - 1
 * Then, generate confirmation number. Update database.
 */
app.post("/confirm", async function(req, res) {
  try {
    let streetAddress = req.body.streetAddress;
    let city = req.body.city;
    let state = req.body.state;
    let postalCode = req.body.postalCode;
    let creditCardNumber = req.body.creditCardNumber;
    let securityCode = req.body.securityCode;
    if (!(creditCardNumber && securityCode && streetAddress && city && state && postalCode)) {
      res.status(400).send("Missing one or more of the required params.");
    }
    let validCardNumber = creditCardNumber.match(/^[0-9]{16}$/);
    let validSecurityCode = securityCode.match(/^[0-9]{3}$/);
    if (validCardNumber === null) {
      res.status(400).send("Invalid credit card number.");
    }
    if (validSecurityCode === null) {
      res.status(400).send("Invalid security code.");
    }
    res.type("text");
    res.status(200).send("Valid Inputs.");
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

app.post("/finish", async function(req, res) {
  try {
    let currentUser = req.cookies.username;
    let db = await getDBConnection();
    let productId = req.body.productId;
    let productAvailabilityQry = "SELECT availability, capacity FROM products WHERE product_id=?";
    let productAvailabilityInfo = await db.get(productAvailabilityQry, [productId]);
    let updateCapacityQry = "UPDATE products SET capacity=?, availability=? WHERE product_id=?";
    let newCapacity = parseInt(productAvailabilityInfo.capacity) - 1;
    let newAvailability;
    if (newCapacity === 0) {
      newAvailability = "Out of Stock";
    } else {
      newAvailability = productAvailabilityInfo.availability;
    }
    await db.run(updateCapacityQry, [String(newCapacity), newAvailability, productId]);
    let transactionQry = "INSERT INTO transactions (username, product_id) VALUES (?, ?);";
    await db.run(transactionQry, [currentUser, productId]);
    let confirmationQry = "SELECT confirmation_number, date FROM transactions WHERE username=? AND product_id=?";
    let confirmationInfo = await db.get(confirmationQry, [currentUser, productId]);
    await db.close();
    res.json(confirmationInfo);
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * Sign up for a new user. Verify email formation.
 * check if the user is already in the database.
 * if a new user, insert the new info into database.
 */
app.post("/signup", async function(req, res) {
  res.type("text");
  try {
    let db = await getDBConnection();
    let email = req.body.email;
    let username = req.body.username;
    let password = req.body.password;
    if (!(email && username && password)) {
      res.status(400).send("Missing one or more of the required params.");
    } else {
      let validEmail = email.match(/^(\w|\.)+@[A-Za-z]+\.(com|org|edu)$/);
      if (validEmail === null) {
        res.status(400).send("Invalid email format.");
      } else {
        let allUsers = await db.all("SELECT username FROM users;");
        if (userExists(allUsers, username)) {
          res.status(400).send("Username already exists.");
        } else {
          const salt = await bcrypt.genSalt(10);
          password = await bcrypt.hash(password, salt);
          let qry = "INSERT INTO users (username, email, password) VALUES (?, ?, ?);";
          await db.run(qry, [username, email, password]);
          await db.close();
          res.send("Signed up successfully!");
        }
      }
    }
  } catch (error) {
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * Get the previous transactions of the logged in user. Returns the transcations info
 * in JSON format
 */
app.get("/orders/:user", async function(req, res) {
  try {
    let user = req.params.user;
    if (user === undefined) {
      res.type("text");
      res.status(400).send("User is not logged in");
    } else {
      let db = await getDBConnection();
      let qry = "SELECT t.confirmation_number, t.product_id, p.name, t.date \
                FROM transactions t, products p \
                WHERE t.product_id = p.product_id AND t.username = ?";
      let rows = await db.all(qry, [user]);
      await db.close();
      res.json(rows);
    }
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

app.get("/cart/:user", async function(req, res) {
  try {
    let user = req.params.user;
    if (user === undefined) {
      res.type("text");
      res.status(400).send("User is not logged in");
    }
    let db = await getDBConnection();
    let qry = "SELECT p.product_id, p.price, p.name, p.descriptions, p.availability \
              FROM shopping_cart s, products p \
              WHERE s.product_id = p.product_id AND s.username = ?";
    let rows = await db.all(qry, [user]);
    await db.close();
    res.json(rows);
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

app.post("/cart/signedIn/add", async function(req, res) {
  try {
    let user = req.cookies.username;
    // console.log(user);
    if (user === undefined) {
      res.type("text");
      res.status(400).send("User is not logged in");
    }
    let productId = req.body.productId;
    let db = await getDBConnection();
    let qry = "INSERT INTO shopping_cart (username, product_id) VALUES(?, ?);";
    await db.run(qry, [user, productId]);
    await db.close();
    res.type("text").send("Added to cart successfully.");
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

app.post("/cart/remove", async function(req, res) {
  try {
    let user = req.cookies.username;
    // console.log(user);
    if (user === undefined) {
      res.type("text");
      res.status(400).send("User is not logged in");
    }
    let productId = req.body.productId;
    let db = await getDBConnection();
    let qry = "DELETE FROM shopping_cart WHERE username = ? AND product_id = ?;";
    await db.run(qry, [user, productId]);
    await db.close();
    res.type("text").send("Removed item from cart successfully.");
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * Add rating and feedback to a product. Returns the feedback info in JSON format.
 */
app.post("/feedback", async function(req, res) {
  try {
    let currentUser = req.cookies.username;
    if (currentUser === undefined) {
      res.type("text");
      res.status(400).send("User is not logged in");
    } else {
      let db = await getDBConnection();
      let productId = req.body.productId;
      let rating = req.body.rating;
      let comment = req.body.comment;
      if (!(rating && comment)) {
        res.type("text");
        res.status(400).send("Missing one or more of the required params.");
      }
      let qry = "INSERT INTO reviews (username, product_id, comment, rating) \
                  VALUES (?, ?, ?, ?);";
      await db.run(qry, [currentUser, productId, comment, rating]);
      let infoQry = "SELECT * FROM reviews WHERE product_id=? AND username=?";
      let rows = await db.get(infoQry, [productId, currentUser]);
      await db.close();
      res.json(rows);
    }
  } catch (error) {
    res.type("text");
    res.status(500).send("An error occurred on the server. Try again later.");
  }
});

/**
 * Establishes a database connection to the database and returns the database object.
 * Any errors that occur should be caught in the function that calls this one.
 * @returns {Object} - The database object for the connection.
 */
async function getDBConnection() {
  const db = await sqlite.open({
    filename: "storage.db",
    driver: sqlite3.Database
  });
  return db;
}

/**
 * Show all product or specific product by searching.
 * @param {string} search - sent key word which users would like to look for.
 * @param {object} db - the latest db.
 * @returns {Object} - The correponding product object if search or total products
 */
function getProducts(search, db) {
  try {
    if (search === undefined) {
      return db.all("SELECT * FROM products;");
    }
    let qry = "SELECT product_id FROM products WHERE name LIKE ? OR category LIKE ? \
               OR descriptions LIKE ?;";
    return db.all(qry, ['%' + search + '%', '%' + search + '%', '%' + search + '%']);
  } catch (error) {
    return error;
  }
}

/**
 * Check if the user name is in the current all users.
 * @param {object} allUsers - All current users in the database.
 * @param {string} user - a user name.
 * @returns {boolean} - User existing/non-existing.
 */
function userExists(allUsers, user) {
  for (let i = 0; i < allUsers.length; i++) {
    if (allUsers[i].username === user) {
      return true;
    }
  }
  return false;
}

app.use(express.static("public"));
const PORT = process.env.PORT || 8000;
app.listen(PORT);
