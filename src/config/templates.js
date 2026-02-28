/**
 * Business Templates for Queuify
 * Used to bootstrap organizations with sane defaults based on their type.
 */
const templates = {
    'Clinic': {
        description: 'Best for Doctors and Therapists. Appointments are scheduled for specific resources.',
        defaultService: 'General Consultation',
        queueScope: 'PER_RESOURCE',
        queueType: 'STATIC',
        icon: 'Hospital'
    },
    'Hospital': {
        description: 'Multi-department facility. Individual doctor queues with scheduled slots.',
        defaultService: 'Emergency Checkup',
        queueScope: 'PER_RESOURCE',
        queueType: 'STATIC',
        icon: 'Building2'
    },
    'Bank': {
        description: 'General queue system. Customers wait for any available counter.',
        defaultService: 'Inquiry/Cashier',
        queueScope: 'PER_SERVICE',
        queueType: 'DYNAMIC',
        icon: 'Landmark'
    },
    'Salon': {
        description: 'Personal services. Appointments with specific stylists or barbers.',
        defaultService: 'Haircut/Styling',
        queueScope: 'PER_RESOURCE',
        queueType: 'STATIC',
        icon: 'Scissors'
    },
    'Service Center': {
        description: 'First-come-first-served walk-in queue for repairs and services.',
        defaultService: 'Device Repair',
        queueScope: 'PER_SERVICE',
        queueType: 'DYNAMIC',
        icon: 'Wrench'
    },
    'Government Office': {
        description: 'Manage public queues and appointments for various services.',
        defaultService: 'Public Service',
        queueScope: 'PER_SERVICE',
        queueType: 'DYNAMIC',
        icon: 'Building'
    },
    'Consultancy': {
        description: 'Schedule professional consultations and meetings.',
        defaultService: 'Consultation Session',
        queueScope: 'PER_RESOURCE',
        queueType: 'STATIC',
        icon: 'Briefcase'
    },
    'Coaching Institute': {
        description: 'Manage student batches, personal coaching, and doubt sessions.',
        defaultService: 'Doubt Clearing Session',
        queueScope: 'PER_RESOURCE',
        queueType: 'STATIC',
        icon: 'GraduationCap'
    },
    'Other': {
        description: 'General purpose central queue for any service.',
        defaultService: 'Standard Service',
        queueScope: 'PER_SERVICE',
        queueType: 'DYNAMIC',
        icon: 'Box'
    }
};

module.exports = templates;
