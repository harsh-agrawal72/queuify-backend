const express = require('express');
const authRoute = require('./auth.route');
const organizationRoute = require('./organization.route');
const slotRoute = require('./slot.route');
const userRoute = require('./user.route');
const appointmentRoute = require('./appointment.route');
const analyticsRoute = require('./analytics.route');
const adminRoute = require('./admin.route');
const superadminRoute = require('./superadmin.route');
const serviceRoute = require('./service.route');
const resourceRoute = require('./resource.route');
const planRoute = require('./plan.route');
const contactRoute = require('./contact.route');

const router = express.Router();

const defaultRoutes = [
    {
        path: '/auth',
        route: authRoute,
    },
    {
        path: '/organizations',
        route: organizationRoute,
    },
    {
        path: '/slots',
        route: slotRoute,
    },
    {
        path: '/appointments',
        route: appointmentRoute,
    },
    {
        path: '/analytics',
        route: analyticsRoute,
    },
    {
        path: '/admin',
        route: adminRoute,
    },
    {
        path: '/superadmin',
        route: superadminRoute,
    },
    {
        path: '/services',
        route: serviceRoute,
    },
    {
        path: '/resources',
        route: resourceRoute,
    },
    {
        path: '/user',
        route: userRoute,
    },
    {
        path: '/plans',
        route: planRoute,
    },
    {
        path: '/notifications',
        route: require('./notification.route'),
    },
    {
        path: '/reviews',
        route: require('./review.route'),
    },
    {
        path: '/contact',
        route: contactRoute,
    },
];

defaultRoutes.forEach((route) => {
    router.use(route.path, route.route);
});

module.exports = router;
