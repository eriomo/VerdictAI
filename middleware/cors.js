'use strict';

const corsOptions = {
  origin: true,
  credentials: true,
  methods: 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization',
};

module.exports = {
  corsOptions,
};
