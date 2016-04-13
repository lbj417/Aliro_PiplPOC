var express = require('express');
var router = express.Router();

// controller
var job = require('../controllers/job');

/* Begin job search process */
router.get('/',
  job.launchPage
);

router.post('/',
  job.launch
);

router.get('/:jobId',
  job.beginPeopleSearch
);

module.exports = router;
