var express = require('express');
var router = express.Router();

// controller
var job = require('../controllers/job');

/* Begin job search process */
router.get('/',
	job.beginPeopleSearch
);

module.exports = router;
