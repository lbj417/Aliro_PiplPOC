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
          res.status(200).send(people);
        }
        else {
          res.status(err).end();
        }
      });
    }
  });
};
