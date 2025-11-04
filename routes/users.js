// Load required packages
var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (router) {
    // Helper function to parse query parameters
    function parseQueryParams(req) {
        var query = {};
        
        // Parse where parameter
        if (req.query.where) {
            try {
                query.where = JSON.parse(req.query.where);
            } catch (e) {
                return { error: 'Invalid where parameter' };
            }
        }
        
        // Parse sort parameter
        var sort = {};
        if (req.query.sort) {
            try {
                sort = JSON.parse(req.query.sort);
            } catch (e) {
                return { error: 'Invalid sort parameter' };
            }
        }
        
        // Parse select parameter
        var select = {};
        if (req.query.select) {
            try {
                select = JSON.parse(req.query.select);
            } catch (e) {
                return { error: 'Invalid select parameter' };
            }
        }
        
        // Parse skip and limit
        var skip = req.query.skip ? parseInt(req.query.skip) : 0;
        var limit = req.query.limit ? parseInt(req.query.limit) : undefined;
        
        // Parse count
        var count = req.query.count === 'true';
        
        return { query, sort, select, skip, limit, count };
    }
    
    // Helper function to send response
    function sendResponse(res, statusCode, message, data) {
        res.status(statusCode).json({
            message: message,
            data: data
        });
    }
    
    // Helper function to send error response
    function sendError(res, statusCode, message, data) {
        res.status(statusCode).json({
            message: message,
            data: data || null
        });
    }
    
    // GET /api/users - Get all users
    var usersRoute = router.route('/users');
    
    usersRoute.get(function (req, res) {
        var params = parseQueryParams(req);
        if (params.error) {
            return sendError(res, 400, params.error);
        }
        
        var mongooseQuery = User.find(params.query || {});
        
        // Apply sort
        if (Object.keys(params.sort).length > 0) {
            mongooseQuery = mongooseQuery.sort(params.sort);
        }
        
        // Apply select
        if (Object.keys(params.select).length > 0) {
            mongooseQuery = mongooseQuery.select(params.select);
        }
        
        // Apply skip
        if (params.skip > 0) {
            mongooseQuery = mongooseQuery.skip(params.skip);
        }
        
        // Apply limit (unlimited for users by default)
        if (params.limit !== undefined) {
            mongooseQuery = mongooseQuery.limit(params.limit);
        }
        
        // Handle count
        if (params.count) {
            User.countDocuments(params.query || {}).exec(function (err, count) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to count users' });
                }
                sendResponse(res, 200, 'OK', { count: count });
            });
        } else {
            mongooseQuery.exec(function (err, users) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to retrieve users' });
                }
                sendResponse(res, 200, 'OK', users);
            });
        }
    });
    
    // POST /api/users - Create a new user
    usersRoute.post(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.email) {
            return sendError(res, 400, 'Bad request', { error: 'Name and email are required' });
        }
        
        // Create user
        var user = new User({
            name: req.body.name,
            email: req.body.email,
            pendingTasks: req.body.pendingTasks || [],
            dateCreated: req.body.dateCreated || Date.now()
        });
        
        user.save(function (err, savedUser) {
            if (err) {
                if (err.code === 11000) {
                    return sendError(res, 400, 'Bad request', { error: 'Email already exists' });
                }
                return sendError(res, 500, 'Server error', { error: 'Failed to create user' });
            }
            sendResponse(res, 201, 'Created', savedUser);
        });
    });
    
    // GET /api/users/:id - Get user by ID
    var userByIdRoute = router.route('/users/:id');
    
    userByIdRoute.get(function (req, res) {
        var params = parseQueryParams(req);
        if (params.error) {
            return sendError(res, 400, params.error);
        }
        
        var mongooseQuery = User.findById(req.params.id);
        
        // Apply select for single user
        if (Object.keys(params.select).length > 0) {
            mongooseQuery = mongooseQuery.select(params.select);
        }
        
        mongooseQuery.exec(function (err, user) {
            if (err) {
                return sendError(res, 500, 'Server error', { error: 'Failed to retrieve user' });
            }
            if (!user) {
                return sendError(res, 404, 'Not found', { error: 'User not found' });
            }
            sendResponse(res, 200, 'OK', user);
        });
    });
    
    // PUT /api/users/:id - Update user
    userByIdRoute.put(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.email) {
            return sendError(res, 400, 'Bad request', { error: 'Name and email are required' });
        }
        
        User.findById(req.params.id, function (err, user) {
            if (err) {
                return sendError(res, 500, 'Server error', { error: 'Failed to retrieve user' });
            }
            if (!user) {
                return sendError(res, 404, 'Not found', { error: 'User not found' });
            }
            
            // Get old pendingTasks for comparison
            var oldPendingTasks = user.pendingTasks || [];
            
            // Update user fields
            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = req.body.pendingTasks || [];
            
            // Save user
            user.save(function (err, updatedUser) {
                if (err) {
                    if (err.code === 11000) {
                        return sendError(res, 400, 'Bad request', { error: 'Email already exists' });
                    }
                    return sendError(res, 500, 'Server error', { error: 'Failed to update user' });
                }
                
                // Update tasks' assignedUser and assignedUserName
                // Remove tasks from old pendingTasks that are no longer in new pendingTasks
                var tasksToUnassign = oldPendingTasks.filter(function(taskId) {
                    return updatedUser.pendingTasks.indexOf(taskId) === -1;
                });
                
                // Unassign tasks
                Task.updateMany(
                    { _id: { $in: tasksToUnassign } },
                    { $set: { assignedUser: "", assignedUserName: "unassigned" } },
                    function(err) {
                        if (err) {
                            console.error('Error updating tasks:', err);
                        }
                    }
                );
                
                // Update assignedUser and assignedUserName for tasks in new pendingTasks
                Task.updateMany(
                    { _id: { $in: updatedUser.pendingTasks } },
                    { $set: { assignedUser: req.params.id, assignedUserName: updatedUser.name } },
                    function(err) {
                        if (err) {
                            console.error('Error updating task user names:', err);
                        }
                    }
                );
                
                sendResponse(res, 200, 'OK', updatedUser);
            });
        });
    });
    
    // DELETE /api/users/:id - Delete user
    userByIdRoute.delete(function (req, res) {
        User.findById(req.params.id, function (err, user) {
            if (err) {
                return sendError(res, 500, 'Server error', { error: 'Failed to retrieve user' });
            }
            if (!user) {
                return sendError(res, 404, 'Not found', { error: 'User not found' });
            }
            
            // Unassign all tasks assigned to this user
            Task.updateMany(
                { assignedUser: req.params.id },
                { $set: { assignedUser: "", assignedUserName: "unassigned" } },
                function(err) {
                    if (err) {
                        console.error('Error unassigning tasks:', err);
                    }
                }
            );
            
            // Delete user
            user.remove(function (err) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to delete user' });
                }
                res.status(204).send();
            });
        });
    });
    
    return router;
};

