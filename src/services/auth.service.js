const httpStatus = require('../utils/httpStatus');
const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const userModel = require('../models/user.model');
const organizationModel = require('../models/organization.model');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config/config');
const client = new OAuth2Client(config.googleClientId); // Ensure config has googleClientId
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const emailService = require('./email.service');
const templates = require('../config/templates');
const serviceService = require('./service.service');
const resourceService = require('./resource.service');

/**
 * Login with Google
 * @param {string} token
 * @returns {Promise<Object>}
 */
const loginWithGoogle = async (token) => {
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: config.googleClientId,
        });
        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;
        const finalName = name || email.split('@')[0];

        let user = await userModel.getUserByEmail(email);

        if (!user) {
            user = await userModel.createUser({
                name: finalName,
                email,
                password: null,
                role: 'user',
                is_email_verified: true,
                provider: 'google',
                google_id: googleId
            });
        } else {
            if (!user.google_id) {
                user = await userModel.updateUserByType(user.id, {
                    google_id: googleId,
                    provider: 'google'
                });
            }
        }

        if (user.is_suspended) {
            throw new ApiError(httpStatus.FORBIDDEN, 'Your account is suspended.');
        }

        return user;
    } catch (error) {
        console.error('Google Auth Error Details:', error);
        // If it's already an ApiError, rethrow it
        if (error instanceof ApiError) throw error;
        throw new ApiError(httpStatus.UNAUTHORIZED, `Google authentication failed: ${error.message}`);
    }
};

const registerOrganization = async (orgBody, adminBody) => {
    const existingUser = await userModel.getUserByEmail(adminBody.email);
    if (existingUser) {
        if (existingUser.role === 'user') {
            throw new ApiError(httpStatus.BAD_REQUEST, 'You are already registered as a user. Please use a different email to become an administrator.');
        }
        throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken by an administrator or superadmin');
    }

    const { orgName, orgEmail, orgPhone, orgAddress, type } = orgBody;

    // Check for existing organization with same email or phone
    const existingOrgEmail = await organizationModel.getOrganizationByEmail(orgEmail);
    if (existingOrgEmail) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Business email is already registered with another organization');
    }

    const existingOrgPhone = await organizationModel.getOrganizationByPhone(orgPhone);
    if (existingOrgPhone) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Business phone number is already registered with another organization');
    }

    // Generate Org Code
    const codePrefix = orgName.trim().substring(0, 3).toUpperCase();
    const codeSuffix = Math.floor(100 + Math.random() * 900);
    const orgCode = `${codePrefix}${codeSuffix}`;

    // Generate clean slug
    let baseSlug = orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = baseSlug;

    // Check if slug exists, if so append random characters
    let slugExists = await organizationModel.getOrganizationBySlug(slug);
    if (slugExists) {
        const randomString = Math.random().toString(36).substring(2, 6); // 4 random chars
        slug = `${baseSlug}-${randomString}`;
    }

    // 1. Create Org
    const org = await organizationModel.createOrganization({
        name: orgName,
        slug,
        contactEmail: orgEmail,
        phone: orgPhone,
        address: orgAddress,
        plan: 'basic',
        orgCode,
        type: type || 'Clinic'
    });

    // 2. Bootstrap default settings based on template
    const template = templates[type] || templates['Other'];

    // Create Default Service
    const service = await serviceService.createService(org.id, {
        name: template.defaultService,
        description: `Default service created for ${type}`,
        queue_type: template.queueType,
        queue_scope: template.queueScope,
        estimated_service_time: 30,
        is_paid: false
    });

    // Create Default Resource (General Staff/Counter)
    await resourceService.createResource(org.id, {
        name: type === 'Clinic' || type === 'Hospital' || type === 'Salon' ? 'Default Staff Member' : 'Default Counter',
        description: 'Auto-generated resource',
        concurrent_capacity: 1,
        services: [service.id]
    });

    // 3. Create Admin
    const hashedPassword = await bcrypt.hash(adminBody.password, 8);
    const user = await userModel.createUser({
        name: adminBody.name,
        email: adminBody.email,
        password: hashedPassword,
        role: 'admin',
        orgId: org.id,
        is_email_verified: true
    });

    return { user, org };
};



/**
 * Public registration
 * - Default role: 'user'
 * - Default orgId: null
 * - Admin registration remains for specific flows (requires orgName)
 */
const register = async (userBody) => {
    const { name, email, password, role, orgName } = userBody;

    if (await userModel.isEmailTaken(email)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }

    // Default to 'user' if not specified or invalid
    let finalRole = 'user';
    let finalOrgId = null;

    // Allow admin creation if explicitly requested with orgName
    if (role === 'admin') {
        if (!orgName || !orgName.trim()) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Organization name is required for admin registration');
        }
        const slug = orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Generate Org Code (e.g. CLINIC -> CLI001)
        // Simple logic: First 3 chars + random 3 digits
        const codePrefix = orgName.trim().substring(0, 3).toUpperCase();
        const codeSuffix = Math.floor(100 + Math.random() * 900);
        const orgCode = `${codePrefix}${codeSuffix}`; // collision possible but rare for demo

        const org = await organizationModel.createOrganization({
            name: orgName.trim(),
            slug,
            contactEmail: email,
            orgCode
        });
        finalRole = 'admin';
        finalOrgId = org.id;
    }
    // Normal user registration (no orgId, no orgName)
    else {
        finalRole = 'user';
        finalOrgId = null;
    }

    const hashedPassword = await bcrypt.hash(password, 8);
    const user = await userModel.createUser({
        name,
        email,
        password: hashedPassword,
        role: finalRole,
        orgId: finalOrgId,
    });
    return user;
};

/**
 * Login with email and password
 */
const loginUserWithEmailAndPassword = async (email, password) => {
    const user = await userModel.getUserByEmail(email);

    if (!user) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
    }

    // Check if password is set (for invited admins)
    if (user.is_password_set === false) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Your password is not set. Please use the link in your invitation email to set your password.');
    }

    // Check for suspension
    if (user.is_suspended) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Your account is suspended. Please contact your organization administrator.');
    }

    // Check organization status
    if (user.org_id) {
        const orgRes = await pool.query('SELECT status FROM organizations WHERE id = $1', [user.org_id]);
        const org = orgRes.rows[0];

        if (!org) {
            throw new ApiError(httpStatus.FORBIDDEN, 'Organization not found');
        }

        if (org.status === 'suspended' || org.status === 'disabled' || org.status === 'deactivated') {
            throw new ApiError(httpStatus.FORBIDDEN, 'Your organization account is suspended or deactivated. Please contact support.');
        }
    }

    // Update last login
    await userModel.updateUserLastLogin(user.id);

    const { password_hash, ...safeUser } = user;
    return safeUser;
};

/**
 * Create org admin — only callable by superadmin
 */
const createOrgAdmin = async (adminBody, creatorUser) => {
    if (creatorUser.role !== 'superadmin') {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only superadmin can create organization admins');
    }
    if (await userModel.isEmailTaken(adminBody.email)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }

    // Validate org exists
    const org = await organizationModel.getOrganizationById(adminBody.orgId);
    if (!org) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Organization not found');
    }

    const hashedPassword = await bcrypt.hash(adminBody.password, 8);
    const user = await userModel.createUser({
        name: adminBody.name,
        email: adminBody.email,
        password: hashedPassword,
        role: 'admin',
        orgId: adminBody.orgId,
    });
    return user;
};


const resetPassword = async (token, newPassword) => {
    try {
        const payload = await tokenService.verifyToken(token, 'resetPassword');
        const user = await userModel.getUserByEmail(payload.email);
        if (!user) {
            throw new Error();
        }
        const hashedPassword = await bcrypt.hash(newPassword, 8);
        await userModel.updateUserPasswordAndStatus(user.id, hashedPassword, true);
        return user;
    } catch (error) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
    }
};

const forgotPassword = async (email) => {
    const user = await userModel.getUserByEmail(email);
    if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'No user found with this email');
    }
    const resetPasswordToken = await tokenService.generateResetPasswordToken(email);
    const resetPasswordUrl = `${config.clientUrl}/reset-password?token=${resetPasswordToken}`;

    // Send email
    const subject = 'Reset Password';
    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 12px;">
            <h2 style="color: #4F46E5;">Reset Your Password</h2>
            <p>You requested a password reset. Click the button below to reset it:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetPasswordUrl}" style="display: inline-block; padding: 14px 28px; background-color: #4F46E5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
            </div>
            <p>This link will expire in 1 hour.</p>
            <p style="color: #666; font-size: 14px;">If you did not request this, please ignore this email.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999;">Queuify Manager Team</p>
        </div>
    `;
    await emailService.sendEmail(email, subject, html);
};

const setPassword = async (token, newPassword) => {
    try {
        // Verify token (assuming it's a standard JWT or similar setup token)
        // For simplicity in this flow, we'll verify it as a 'reset' or special 'invite' token
        const payload = await tokenService.verifyToken(token, 'invite');
        const user = await userModel.getUserById(payload.sub);

        if (!user) {
            console.error('User not found for ID:', payload.sub);
            throw new ApiError(httpStatus.BAD_REQUEST, 'User not found');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 8);

        // Update password and set is_password_set = true
        // We need a model function for this update
        await userModel.updateUserPasswordAndStatus(user.id, hashedPassword, true);

        return user;
    } catch (error) {
        console.error('Error in setPassword:', error);
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or expired invitation token');
    }
};

module.exports = {
    register,
    loginUserWithEmailAndPassword,
    createOrgAdmin,
    loginWithGoogle,
    registerOrganization,
    setPassword,
    forgotPassword,
    resetPassword,
};
