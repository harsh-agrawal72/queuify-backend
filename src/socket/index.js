const socketIo = require('socket.io');

let io;

const init = (httpServer) => {
    io = socketIo(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Join rooms for targeted updates
        socket.on('join_org', (orgId) => socket.join(`org_${orgId}`));
        socket.on('join_service', (serviceId) => socket.join(`service_${serviceId}`));
        socket.on('join_resource', (resourceId) => socket.join(`resource_${resourceId}`));

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
    // Emit to organization, service, or resource room
    io.to(`org_${partitionKey.orgId}`).emit('queue_update', data);
    if (partitionKey.serviceId) io.to(`service_${partitionKey.serviceId}`).emit('queue_update', data);
    if (partitionKey.resourceId) io.to(`resource_${partitionKey.resourceId}`).emit('queue_update', data);
};

module.exports = {
    init,
    getIO,
    emitQueueUpdate
};
