const socketIo = require('socket.io');

let io;

const init = (httpServer) => {
    io = socketIo(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        connectTimeout: 45000
    });

    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Join rooms for targeted updates
        socket.on('join_org', (orgId) => socket.join(`org_${orgId}`));
        socket.on('join_service', (serviceId) => socket.join(`service_${serviceId}`));
        socket.on('join_resource', (resourceId) => socket.join(`resource_${resourceId}`));
        socket.on('join_user', ({ userId, role }) => {
            socket.join(`user_${userId}`);
            // Join role-specific broadcast rooms
            if (role === 'admin') {
                socket.join('admins');
                console.log(`Admin ${userId} joined 'admins' room`);
            } else if (role === 'user') {
                socket.join('users');
                console.log(`User ${userId} joined 'users' room`);
            }
        });

        // Chat Rooms
        socket.on('join_chat', (conversationId) => socket.join(`chat_${conversationId}`));
        socket.on('leave_chat', (conversationId) => socket.leave(`chat_${conversationId}`));
        socket.on('chat_typing', (data) => {
            // data = { conversationId, senderType, isTyping }
            socket.to(`chat_${data.conversationId}`).emit('chat_typing_update', data);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
};

const emitQueueUpdate = (partitionKey, data) => {
    if (!io) return;
    // Emit to organization room (Admin Dashboard/Live Queue)
    io.to(`org_${partitionKey.orgId}`).emit('queue_update', data);
    
    // Targeted emits
    if (partitionKey.serviceId) io.to(`service_${partitionKey.serviceId}`).emit('queue_update', data);
    if (partitionKey.resourceId) io.to(`resource_${partitionKey.resourceId}`).emit('queue_update', data);
    if (partitionKey.userId) io.to(`user_${partitionKey.userId}`).emit('queue_update', data);
};

module.exports = {
    init,
    getIO,
    emitQueueUpdate
};
