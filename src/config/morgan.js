const morgan = require('morgan');

const successHandler = morgan('dev');

const errorHandler = morgan('combined');

module.exports = {
  successHandler,
  errorHandler,
};
