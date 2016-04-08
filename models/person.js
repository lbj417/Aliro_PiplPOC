/**
 * app/models/person.js
 */

//-----------------------------------------------------------------------------

// set requires
var db = require('./db_connect');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

//-----------------------------------------------------------------------------

var PersonSchema = new Schema({
  data : {type: Schema.Types.Mixed}
});

//-----------------------------------------------------------------------------

module.exports = mongoose.model('person', PersonSchema);
