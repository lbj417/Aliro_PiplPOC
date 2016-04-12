"use strict";

// set requires
var MongoClient = require('mongodb').MongoClient
  , ObjectId = require('mongodb').ObjectId
  , Promise = require('bluebird').Promise
  , AWS = require('aws-sdk')
  , async = require('async')
  , request = require('request')
  , url = require('url')
  , _ = require('underscore')
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
          db.close();
          if (err) {
            console.error('Error getting job details', err);
            return callback(500);
          }
          else if (!jobDetails) {
            console.error('No job details found for provided job ID');
            return callback(404);
          }
          else {
            return callback(null, jobDetails);
          }
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

  var params = {
      queryParser: 'lucene'
    , return: 'person_e'
    , size: 700
    , query: query
    , start: 0
  };
console.log(process.env.TEST_MODE);
  if (process.env.TEST_MODE === 'true') {
    //params.size = 400;
  }

  let people = {};
  let names = [];
  
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

    names = Object.keys(people);

    if (names.length > params.size) {
      names.splice(0, names.length - params.size);
    }

    return callback(null, names);
  });
};

exports.sendNamesToPipl = function(jobTitle, names, callback) {
  MongoClient.connect(process.env.MONGODB_PIPL_DSN, function(err, db) {
    // we will be saving this data to our PIPL db, so if we can't connect, error out
    if (err) {
      console.log('Error connecting to Aliro database', err);
      return callback(500);
    }

    // set vars
    var Person = db.collection('person');
    var meta = [];
    var stats = {
        single_person_email: 0
      , single_person_no_email: 0
      , possible_person_response: 0
      , possible_persons: 0
      , non_match: 0
    };

    // pipl limits API calls to 20 per second, so we will split up the array...
    var CHUNK_SIZE = 20;
    for (var i = 0; i < names.length; i += CHUNK_SIZE) {
      meta.push(names.slice(i, i + CHUNK_SIZE));
    }

    // go through each array of 20 people
    async.eachSeries(meta, function(namesArr, outerCb) {
      // loop through each person in the smaller array
      async.each(namesArr, function(name, innerCb) {
        var path = url.format({
          pathname: 'https://api.pipl.com/search/',
          query: {
              key: process.env.PIPL_API_KEY || 'sample_key'
            , person: JSON.stringify({
                'names': [{'raw': name}]
              //, 'jobs': [{title: jobTitle}]
              , 'addresses': [{country: 'US'}]
            })
            , minimum_match: 0.1
          }
        });
        request({url: path, json: true}, function(err, response, body) {
          if (err || !body) {
            // log error and move on
            console.log('Error or no body in PIPL response ', err, body);
            innerCb();
          }
          else {
            if (body.person) {
              // only save full person matches who have an email address
              if (body.person.emails && body.person.emails.length) {
                // a single person was matched to the query -- save the person
                // TODO this may be considered a full_person - see https://pipl.com/dev/reference/#search-pointer
                var p = Object.assign({full_person: true, person_type: 'single'}, body.person);
                Person.insert({data: p}, function(err, result) {
                  if (err) {
                    console.log('Error inserting a single person object ', err, result);
                  }
                  else {
                    stats.single_person_email++;
                  }
                  innerCb();
                });
              }
              else {
                // single person found, but they don't have emails
                stats.single_person_no_email++;
                innerCb();
              }
            }
            else if (body.possible_persons) {
              stats.possible_person_response++;
              async.each(body.possible_persons, function(person, saveCb) {
                var p = Object.assign({full_person: false, person_type: 'possible'}, person);
                Person.insert({data: p}, function(err, result) {
                  if (err) {
                    console.log('Error occurred inserting a possible person object: ', err);
                  }
                  else {
                    stats.possible_persons++;
                  }
                  saveCb();
                });
              }, function(err) {
                innerCb();
              });
            }
            else {
              // non match
              console.log('Non match received.');
              stats.non_match++;
              innerCb();
            }
          }
        });
      }, function(err) {
        // ensure a second has passed
        setTimeout(outerCb, 1500);
      });
    }, function(err) {
      db.close();
      stats.single_persons = stats.single_person_email + stats.single_person_no_email;
      console.log('Final stats: ', stats);
      return callback(null, stats);
    });
  });
};

exports.searchJobTitle = function(jobDetails, callback) {
  MongoClient.connect(process.env.MONGODB_PIPL_DSN, function(err, db) {
    if (err) {
      console.log('Error connecting to Aliro database', err);
      return callback(500);
    }

    var Person = db.collection('person');
    var peopleToReturn, peopleToQuery;

    Person.find({'data.jobs.title': {$regex: jobDetails.title, $options: 'i'}}).toArray(function(err, docs) {
      if (!err && docs) {
        // separate out those we need to make add'l API call for...
        var partition = _.partition(docs, function(elem) {
          if (elem.data && elem.data.full_person) {
            return elem;
          }
        });
        // fully populated persons
        peopleToReturn = partition[0];
        // still need to populate
        peopleToQuery = partition[1];

        // pipl limits API calls to 20 per second, so we will split up the array...
        var meta = [];
        var CHUNK_SIZE = 20;
        for (var i = 0; i < peopleToQuery.length; i += CHUNK_SIZE) {
          meta.push(peopleToQuery.slice(i, i + CHUNK_SIZE));
        }
        // go through each array of 20 people
        async.eachSeries(meta, function(personArr, outerCb) {
          // loop through each person in the smaller array
          async.each(personArr, function(person, innerCb) {
            var path = url.format({
              pathname: 'https://api.pipl.com/search/',
              query: {
                  key: process.env.PIPL_API_KEY || 'sample_key'
                , search_pointer: person.data['@search_pointer']
                , match_requirements: 'emails'
              }
            });
            request({url: path, json: true}, function(err, response, body) {
              if (err || !body || !body.person) {
                console.log('error with search pointer search: ', err);
                innerCb();
              }
              else {
                var p = Object.assign({full_person: true, person_type: person.data.person_type}, body.person);
                Person.findOneAndUpdate({_id: person._id}
                  , {$set: {data: p}}
                  , {
                    returnOriginal: false
                  }
                  , function(err, fullPerson) {
                    if (err || !fullPerson) {
                      console.log('error updating person object', err);
                    }
                    else {
                      peopleToReturn.push(fullPerson.value);
                    }
                    innerCb();
                  });
              }
            });
          }, function(err) {
            setTimeout(outerCb, 1500);
          });
        }, function(err) {
          db.close();
          return callback(null, peopleToReturn);
        });
      }
      else {
        console.log('no docs found');
        db.close();
        return callback(null, []);
      }
    });
  });
};

function isValidName(name) {
  return name.match(/^\s*([a-z]{2,})\s+([a-z]{2,})\s*$/gi) != null
  || name.match(/^\s*([a-z]{2,})\s+([a-z]{2,})\s+([a-z]{2,})\s*$/gi) != null
  || name.match(/^\s*([a-z]{2,})\s+([a-z])\s+([a-z]{2,})\s*$/gi) != null
  || name.match(/^\s*([a-z]{2,})\s+([a-z])-([a-z]{2,})\s*$/gi) != null;
}
