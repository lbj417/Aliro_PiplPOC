"use strict";

// set requires
var mongoose = require('mongoose')
  , Person = require('../models/person')
  , PersonSchema = mongoose.model('person')
  , MongoClient = require('mongodb').MongoClient
  , ObjectId = require('mongodb').ObjectId
  , Promise = require('bluebird').Promise
  , AWS = require('aws-sdk')
;

//-----------------------------------------------------------------------------

exports.getJobDetails = function(jobId, callback) {
  MongoClient.connect(process.env.MONGODB_DSN, function(err, db) {
    if (err) {
      console.error('Error connecting to Aliro database', err);
      return callback(500);
    }
    else {
      console.log('Successfully connected to Aliro database...');
      db.collection('Job').findOne({_id: ObjectId(jobId)}
        , {title: 1, jobFunction: 1, requiredSkills: 1, desiredSkills: 1}
        , function(err, jobDetails) {
        console.log(err, jobDetails);
        db.close();
        return callback(null, jobDetails);
      });
    }
  });
};

exports.searchCloudSearch = function(jobData, callback) {
  const csd = new AWS.CloudSearchDomain({endpoint: process.env.CS_SEARCH_DOMAIN, region: process.env.AWS_REGION});
  const query = '"' +
    [jobData.title, jobData.jobFunction].concat(jobData.desiredSkills, jobData.requiredSkills)
    .map(item => item.replace(/"/g, ""))
    .join('" OR "') + '"';

  // TODO: return 700
  var params = {
      queryParser: 'lucene'
    , return: 'person_e'
    , size: 100
    , query: query
    , start: 0
  };

  let people = {};
  
  csd.search(params, function(err, searchResult) {
    if (err) {
      return callback(500);
    }
    
    searchResult.hits.hit.forEach(person => {
      if (person && person.fields && person.fields.person_e && person.fields.person_e.length) {
        person.fields.person_e
        .filter(isValidName)
        .forEach(name => people[name] = person.id);
      }
    });

    return callback(null, people);
  });
};

function isValidName(name) {
    return name.match(/^\s*([a-z]{2,})\s+([a-z]{2,})\s*$/gi) != null
    || name.match(/^\s*([a-z]{2,})\s+([a-z]{2,})\s+([a-z]{2,})\s*$/gi) != null
    || name.match(/^\s*([a-z]{2,})\s+([a-z])\s+([a-z]{2,})\s*$/gi) != null
    || name.match(/^\s*([a-z]{2,})\s+([a-z])-([a-z]{2,})\s*$/gi) != null;
}
