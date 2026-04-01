'use strict';

const express = require('express');

const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';

const router = express.Router();

router.get('/', (req, res) => res.json({ status: 'ok', version: '5.0.0' }));
router.get('/config', (req, res) => res.json({ paystackPublicKey: PAYSTACK_PUBLIC_KEY }));

module.exports = router;
