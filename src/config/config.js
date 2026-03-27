const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const envVarsSchema = Joi.object()
    .keys({
        NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
        PORT: Joi.number().default(3000),
        POSTGRES_HOST: Joi.string().required().description('PostgreSQL host'),
        POSTGRES_PORT: Joi.number().default(5432).description('PostgreSQL port'),
        POSTGRES_USER: Joi.string().required().description('PostgreSQL username'),
        POSTGRES_PASSWORD: Joi.string().required().description('PostgreSQL password'),
        POSTGRES_DB: Joi.string().required().description('PostgreSQL database name'),
        JWT_SECRET: Joi.string().required().description('JWT secret key'),
        JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(30).description('minutes after which access tokens expire'),
        SMTP_HOST: Joi.string().description('server that will send the emails'),
        SMTP_PORT: Joi.number().description('port to connect to the email server'),
        SMTP_USER: Joi.string().description('username for email server'),
        SMTP_PASS: Joi.string().description('password for email server'),
        RESEND_API_KEY: Joi.string().description('Resend API Key'),
        EMAIL_FROM: Joi.string().description('the from field in the emails sent by the app'),
        CLIENT_URL: Joi.string().required().description('Client url'),
        GOOGLE_CLIENT_ID: Joi.string().required().description('Google Client ID'),
        BASE_URL: Joi.string().description('Base URL of the server'),
        ENABLE_EMAIL: Joi.any().default(true).description('Global email toggle'),
    })
    .unknown();

const result = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);
const { value: envVars, error } = result;

if (error) {
    console.error('Config validation error:', error.message);
    console.log('Loaded Env Keys:', Object.keys(process.env));
    throw new Error(`Config validation error: ${error.message}`);
}

module.exports = {
    env: envVars.NODE_ENV,
    port: envVars.PORT,
    postgres: {
        host: envVars.POSTGRES_HOST,
        port: envVars.POSTGRES_PORT,
        user: envVars.POSTGRES_USER,
        password: envVars.POSTGRES_PASSWORD,
        database: envVars.POSTGRES_DB,
    },
    jwt: {
        secret: envVars.JWT_SECRET,
        accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    },
    email: {
        smtp: {
            host: envVars.SMTP_HOST,
            port: envVars.SMTP_PORT,
            user: envVars.SMTP_USER,
            pass: envVars.SMTP_PASS,
        },
        mailjet: {
            apiKey: envVars.MAILJET_API_KEY,
            apiSecret: envVars.MAILJET_API_SECRET,
        },
        resend: {
            apiKey: envVars.RESEND_API_KEY,
        },
        from: envVars.EMAIL_FROM,
        enabled: envVars.ENABLE_EMAIL === true || envVars.ENABLE_EMAIL === 'true',
    },
    clientUrl: envVars.CLIENT_URL,
    baseUrl: envVars.BASE_URL || `http://localhost:${envVars.PORT}`,
    googleClientId: envVars.GOOGLE_CLIENT_ID,
};
