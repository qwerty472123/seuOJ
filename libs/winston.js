const winston = require('winston');

function configureWinston(verbose) {
    winston.configure({
        transports: [
            new (winston.transports.Console)({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            })
        ]
    });
    if (verbose) {
        winston.level = 'debug';
    } else {
        winston.level = 'info';
    }
}

module.exports.configureWinston = configureWinston;
