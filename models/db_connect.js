/**
 * app/models/db_connect.js
 *
 * @description: Provides database connections
 * @author: Laura Jackson <ljackson@mobiquityinc.com>
 */

//-----------------------------------------------------------------------------

var mongoose = require('mongoose')

// connect to db
mongoose.connect('mongodb://localhost/aliroPipl');
var db = mongoose.connection;
db.on('error', function () {
  throw new Error('unable to connect to database at mongodb://localhost/aliroPipl');
});
