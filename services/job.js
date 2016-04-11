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
    , size: 10
    , query: query
    , start: 0
  };

  let people = [];
  
  csd.search(params, function(err, searchResult) {
    if (err) {
      return callback(500);
    }
    
    searchResult.hits.hit.forEach(person => {
      if (person && person.fields && person.fields.person_e && person.fields.person_e.length) {
        person.fields.person_e
        .filter(isValidName)
        .forEach(name => people.push({name: name, id: person.id}));
      }
    });

    return callback(null, people);
  });
};

exports.sendPeopleToPipl = function(people, callback) {
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
        single_person: 0
      , possible_person: 0
      , other: 0
    };

    // pipl limits API calls to 20 per second, so we will split up the array...
    var CHUNK_SIZE = 20;
    for (var i = 0; i < people.length; i += CHUNK_SIZE) {
      meta.push(people.slice(i, i + CHUNK_SIZE));
    }

    // go through each array of 20 people
    async.eachSeries(meta, function(personArr, outerCb) {
      // loop through each person in the smaller array
      async.each(personArr, function(person, innerCb) {
        var path = url.format({
          pathname: 'https://api.pipl.com/search/',
          query: {
              key: process.env.PIPL_API_KEY || 'sample_key'
            , raw_name: person.name
            , country: 'US'
            , match_requirements: '(emails and jobs)'
          }
        });
        request(path, function(err, response, body) {
          body = JSON.parse(body);
          console.log('body', body.person);
          // TODO store in our pipl mongodb
          //db.collection('person').insert
          if (err || !body) {
            // log error and move on
            console.log('Error or no body occurred at 115! ', err, body);
            innerCb();
          }
          else {
            if (body.person) {
              // a single person was matched to the query -- save the person
              var p = Object.assign({full_person: false}, body.person);
              Person.insert({data: p}, function(err, result) {
                if (err) {
                  // log error
                  console.log('Error occurred at 125! ', err, result);
                  //console.error('Error inserting single person object: ', err);
                }
                else {
                  stats.single_person++;
                }
                innerCb();
              });
            }
            else if (body.possible_persons) {
              console.info('ALERT! Possible persons! ', body);
              async.each(body.possible_persons, function(person, saveCb) {
                var p = Object.assign({full_person: false}, person);
                Person.insert({data: p}, function(err, result) {
                  if (err) {
                    console.log('Error occurred inserting a possible person object: ', err);
                  }
                  else {
                    stats.possible_person++;
                  }
                  saveCb();
                });
              }, function(err) {
                innerCb();
              });
            }
            else {
              // match containing required fields was not found
              console.log('Match found with no person or possible_persons. What am I? ', body);
              stats.other++;
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
    //TODO remove this
    jobDetails.title = 'software developer';

    Person.find({'data.jobs': {$elemMatch: {title: {$regex: jobDetails.title, $options: 'i'}}}}).toArray(function(err, docs) {
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
              }
            });
            request({url: path, json: true}, function(err, response, body) {
              if (err || !body || !body.person) {
                console.log('error with search pointer search: ', err);
                innerCb();
              }
              else {
                var p = Object.assign({full_person: true}, body.person);
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
