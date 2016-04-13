var job = require('../services/job.js');

exports.launchPage = function(req, res) {
  res.render('job', {launchPage: true});
};

exports.launch = function(req, res) {
  res.redirect('/jobs/' + process.env.JOB_ID);
};

exports.beginPeopleSearch = function(req, res) {
  // using a hard coded jobId for POC for now
  var jobId = req.params.jobId;
  job.getJobDetails(jobId, function(err, jobDetails) {
    if (err) {
      res.status(err).end();
    }
    else {
      job.searchCloudSearch(jobDetails, function(err, names) {
        if (!err) {
          job.sendNamesToPipl(jobDetails.title, names, function(err, results) {
            job.searchJobTitle(jobDetails, function(err, matches) {
              res.render('job', {jobTitle: jobDetails.title, matches: matches, stats: results, searchSize: names.length});
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
