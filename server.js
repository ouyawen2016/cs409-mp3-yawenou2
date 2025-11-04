// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose'),
    bodyParser = require('body-parser');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Connect to a MongoDB
if (process.env.MONGODB_URI && process.env.MONGODB_URI.trim() !== '') {
    var mongoUri = process.env.MONGODB_URI.trim();
    mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
        .catch(function(err) {
            console.error('Failed to connect to MongoDB:', err.message);
            console.error('Please check your MONGODB_URI in .env file');
        });
    mongoose.connection.on('error', function(err) {
        console.error('MongoDB connection error:', err.message);
    });
    mongoose.connection.once('open', function() {
        console.log('MongoDB connected successfully');
    });
} else {
    console.warn('Warning: MONGODB_URI not set or empty in environment variables');
    console.warn('Please set MONGODB_URI in your .env file');
}

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Use the body-parser package in our application
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

// Start the server
app.listen(port);
console.log('Server running on port ' + port);
