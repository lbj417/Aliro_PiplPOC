var job = require('../services/job.js');

exports.beginPeopleSearch = function(req, res) {
  // using a hard coded jobId for POC for now
  var jobId = process.env.JOB_ID;
  job.getJobDetails(jobId, function(err, jobDetails) {
    if (err) {
      res.status(err).end();
    }
    else {
      job.searchCloudSearch(jobDetails, function(err, people) {
        if (!err) {
          job.sendPeopleToPipl(people, function(err, results) {
            job.searchJobTitle(jobDetails, function(err, matches) {
              res.status(200).json(matches);
            });
          });
        }
        else {
          res.status(err).end();
        }
      });
    }
  });
};
