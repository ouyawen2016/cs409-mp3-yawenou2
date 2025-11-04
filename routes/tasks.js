// Load required packages
var Task = require('../models/task');
var User = require('../models/user');

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
        var limit = req.query.limit ? parseInt(req.query.limit) : 100; // Default 100 for tasks
        
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
    
    // GET /api/tasks - Get all tasks
    var tasksRoute = router.route('/tasks');
    
    tasksRoute.get(function (req, res) {
        var params = parseQueryParams(req);
        if (params.error) {
            return sendError(res, 400, params.error);
        }
        
        var mongooseQuery = Task.find(params.query || {});
        
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
        
        // Apply limit
        mongooseQuery = mongooseQuery.limit(params.limit);
        
        // Handle count
        if (params.count) {
            Task.countDocuments(params.query || {}).exec(function (err, count) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to count tasks' });
                }
                sendResponse(res, 200, 'OK', { count: count });
            });
        } else {
            mongooseQuery.exec(function (err, tasks) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to retrieve tasks' });
                }
                sendResponse(res, 200, 'OK', tasks);
            });
        }
    });
    
    // POST /api/tasks - Create a new task
    tasksRoute.post(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.deadline) {
            return sendError(res, 400, 'Bad request', { error: 'Name and deadline are required' });
        }
        
        // Create task
        var task = new Task({
            name: req.body.name,
            description: req.body.description || "",
            deadline: req.body.deadline,
            completed: req.body.completed !== undefined ? req.body.completed : false,
            assignedUser: req.body.assignedUser || "",
            assignedUserName: req.body.assignedUserName || "unassigned",
            dateCreated: req.body.dateCreated || Date.now()
        });
        
        // If assignedUser is provided, update user's pendingTasks and get userName
        if (task.assignedUser && task.assignedUser !== "") {
            User.findById(task.assignedUser, function (err, user) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to retrieve user' });
                }
                if (!user) {
                    return sendError(res, 400, 'Bad request', { error: 'Assigned user not found' });
                }
                
                task.assignedUserName = user.name;
                
                task.save(function (err, savedTask) {
                    if (err) {
                        return sendError(res, 500, 'Server error', { error: 'Failed to create task' });
                    }
                    
                    // Add task to user's pendingTasks if not already there and not completed
                    if (!savedTask.completed && user.pendingTasks.indexOf(savedTask._id.toString()) === -1) {
                        user.pendingTasks.push(savedTask._id.toString());
                        user.save(function (err) {
                            if (err) {
                                console.error('Error updating user pendingTasks:', err);
                            }
                        });
                    }
                    
                    sendResponse(res, 201, 'Created', savedTask);
                });
            });
        } else {
            task.save(function (err, savedTask) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to create task' });
                }
                sendResponse(res, 201, 'Created', savedTask);
            });
        }
    });
    
    // GET /api/tasks/:id - Get task by ID
    var taskByIdRoute = router.route('/tasks/:id');
    
    taskByIdRoute.get(function (req, res) {
        var params = parseQueryParams(req);
        if (params.error) {
            return sendError(res, 400, params.error);
        }
        
        var mongooseQuery = Task.findById(req.params.id);
        
        // Apply select for single task
        if (Object.keys(params.select).length > 0) {
            mongooseQuery = mongooseQuery.select(params.select);
        }
        
        mongooseQuery.exec(function (err, task) {
            if (err) {
                // Check if it's a CastError (invalid ObjectId format)
                if (err.name === 'CastError') {
                    return sendError(res, 404, 'Not found', { error: 'Task not found' });
                }
                return sendError(res, 500, 'Server error', { error: 'Failed to retrieve task' });
            }
            if (!task) {
                return sendError(res, 404, 'Not found', { error: 'Task not found' });
            }
            sendResponse(res, 200, 'OK', task);
        });
    });
    
    // PUT /api/tasks/:id - Update task
    taskByIdRoute.put(function (req, res) {
        // Validation
        if (!req.body.name || !req.body.deadline) {
            return sendError(res, 400, 'Bad request', { error: 'Name and deadline are required' });
        }
        
        Task.findById(req.params.id, function (err, task) {
            if (err) {
                // Check if it's a CastError (invalid ObjectId format)
                if (err.name === 'CastError') {
                    return sendError(res, 404, 'Not found', { error: 'Task not found' });
                }
                return sendError(res, 500, 'Server error', { error: 'Failed to retrieve task' });
            }
            if (!task) {
                return sendError(res, 404, 'Not found', { error: 'Task not found' });
            }
            
            // Store old assignedUser for cleanup
            var oldAssignedUser = task.assignedUser || "";
            var newAssignedUser = req.body.assignedUser || "";
            
            // Update task fields
            task.name = req.body.name;
            task.description = req.body.description !== undefined ? req.body.description : task.description;
            task.deadline = req.body.deadline;
            task.completed = req.body.completed !== undefined ? req.body.completed : task.completed;
            task.assignedUser = newAssignedUser;
            task.assignedUserName = req.body.assignedUserName || task.assignedUserName;
            
            // If assignedUser is provided, update user's pendingTasks and get userName
            if (newAssignedUser && newAssignedUser !== "") {
                User.findById(newAssignedUser, function (err, user) {
                    if (err) {
                        return sendError(res, 500, 'Server error', { error: 'Failed to retrieve user' });
                    }
                    if (!user) {
                        return sendError(res, 400, 'Bad request', { error: 'Assigned user not found' });
                    }
                    
                    task.assignedUserName = user.name;
                    
                    task.save(function (err, updatedTask) {
                        if (err) {
                            return sendError(res, 500, 'Server error', { error: 'Failed to update task' });
                        }
                        
                        // Remove task from old user's pendingTasks
                        if (oldAssignedUser && oldAssignedUser !== "" && oldAssignedUser !== newAssignedUser) {
                            User.findById(oldAssignedUser, function (err, oldUser) {
                                if (oldUser) {
                                    oldUser.pendingTasks = oldUser.pendingTasks.filter(function(taskId) {
                                        return taskId !== req.params.id;
                                    });
                                    oldUser.save(function (err) {
                                        if (err) {
                                            console.error('Error updating old user pendingTasks:', err);
                                        }
                                    });
                                }
                            });
                        }
                        
                        // If task is completed, remove from user's pendingTasks
                        if (updatedTask.completed) {
                            user.pendingTasks = user.pendingTasks.filter(function(taskId) {
                                return taskId !== req.params.id;
                            });
                            user.save(function (err) {
                                if (err) {
                                    console.error('Error removing completed task from user pendingTasks:', err);
                                }
                            });
                        } else {
                            // Add task to new user's pendingTasks if not already there and not completed
                            if (user.pendingTasks.indexOf(updatedTask._id.toString()) === -1) {
                                user.pendingTasks.push(updatedTask._id.toString());
                                user.save(function (err) {
                                    if (err) {
                                        console.error('Error updating user pendingTasks:', err);
                                    }
                                });
                            }
                        }
                        
                        sendResponse(res, 200, 'OK', updatedTask);
                    });
                });
            } else {
                // Unassign task
                task.assignedUserName = "unassigned";
                
                task.save(function (err, updatedTask) {
                    if (err) {
                        return sendError(res, 500, 'Server error', { error: 'Failed to update task' });
                    }
                    
                    // Remove task from old user's pendingTasks
                    if (oldAssignedUser && oldAssignedUser !== "") {
                        User.findById(oldAssignedUser, function (err, oldUser) {
                            if (oldUser) {
                                oldUser.pendingTasks = oldUser.pendingTasks.filter(function(taskId) {
                                    return taskId !== req.params.id;
                                });
                                oldUser.save(function (err) {
                                    if (err) {
                                        console.error('Error updating old user pendingTasks:', err);
                                    }
                                });
                            }
                        });
                    }
                    
                    sendResponse(res, 200, 'OK', updatedTask);
                });
            }
        });
    });
    
    // DELETE /api/tasks/:id - Delete task
    taskByIdRoute.delete(function (req, res) {
        Task.findById(req.params.id, function (err, task) {
            if (err) {
                // Check if it's a CastError (invalid ObjectId format)
                if (err.name === 'CastError') {
                    return sendError(res, 404, 'Not found', { error: 'Task not found' });
                }
                return sendError(res, 500, 'Server error', { error: 'Failed to retrieve task' });
            }
            if (!task) {
                return sendError(res, 404, 'Not found', { error: 'Task not found' });
            }
            
            // Remove task from assigned user's pendingTasks
            if (task.assignedUser && task.assignedUser !== "") {
                User.findById(task.assignedUser, function (err, user) {
                    if (user) {
                        user.pendingTasks = user.pendingTasks.filter(function(taskId) {
                            return taskId !== req.params.id;
                        });
                        user.save(function (err) {
                            if (err) {
                                console.error('Error updating user pendingTasks:', err);
                            }
                        });
                    }
                });
            }
            
            // Delete task
            task.remove(function (err) {
                if (err) {
                    return sendError(res, 500, 'Server error', { error: 'Failed to delete task' });
                }
                res.status(204).send();
            });
        });
    });
    
    return router;
};

