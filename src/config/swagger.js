/**
 * Swagger/OpenAPI documentation (swagger-jsdoc + swagger-ui-express).
 * Serves UI at /api-docs.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Railway Monitoring API',
      version: '1.0.0',
      description: 'Auth and user management for KIOSK/MONITOR signaling.',
    },
    servers: [{ url: '/', description: 'Server root' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          required: ['user_id', 'password'],
          properties: {
            user_id: { type: 'string', example: 'admin' },
            password: { type: 'string', example: 'admin123' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            accessToken: { type: 'string' },
            role: { type: 'string', enum: ['ADMIN', 'USER'] },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                user_id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string', nullable: true },
                role: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
        CreateUserRequest: {
          type: 'object',
          required: ['user_id', 'name', 'password'],
          properties: {
            user_id: { type: 'string' },
            name: { type: 'string' },
            password: { type: 'string' },
          },
        },
        UserResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            role: { type: 'string', enum: ['ADMIN', 'USER'] },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        UpdateUserRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            password: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },
        FormQuestion: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            form_id: { type: 'string', format: 'uuid' },
            prompt: { type: 'string' },
            is_required: { type: 'boolean' },
            sort_order: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            deleted_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        CreateQuestionRequest: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', example: 'What did you work on today?' },
            is_required: { type: 'boolean', example: true },
            sort_order: { type: 'integer', minimum: 0, example: 0 },
          },
        },
        UpdateQuestionRequest: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            is_required: { type: 'boolean' },
            sort_order: { type: 'integer', minimum: 0 },
          },
        },
        TodayAnswerItem: {
          type: 'object',
          required: ['question_id', 'answer_text'],
          properties: {
            question_id: { type: 'string', format: 'uuid' },
            answer_text: { type: 'string' },
          },
        },
        TodaySubmissionRequest: {
          type: 'object',
          required: ['answers'],
          properties: {
            answers: {
              type: 'array',
              items: { $ref: '#/components/schemas/TodayAnswerItem' },
            },
          },
        },
      },
    },
  },
  apis: [], // paths added programmatically or via JSDoc in route files if desired
};

const spec = swaggerJsdoc(options);

// Add paths manually so we don't depend on JSDoc in route files
spec.paths = spec.paths || {};
spec.paths['/api/auth/login'] = {
  post: {
    tags: ['Auth'],
    summary: 'Login',
    description: 'Authenticate with user_id and password. Returns JWT for socket and REST.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/LoginRequest' },
        },
      },
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginResponse' },
          },
        },
      },
      400: { description: 'Missing user_id or password', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Account inactive', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users'] = {
  post: {
    tags: ['Users'],
    summary: 'Create user (Admin only)',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateUserRequest' },
        },
      },
    },
    responses: {
      201: {
        description: 'User created',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                user: { $ref: '#/components/schemas/UserResponse' },
              },
            },
          },
        },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'user_id or email exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  get: {
    tags: ['Users'],
    summary: 'List users (Admin only)',
    description: 'Supports search and filters via query params: search/q (text across user_id, name, email), role, status.',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'search', in: 'query', description: 'Text search in user_id, name, email', schema: { type: 'string' } },
      { name: 'q', in: 'query', description: 'Same as search', schema: { type: 'string' } },
      { name: 'role', in: 'query', description: 'Filter by role', schema: { type: 'string', enum: ['ADMIN', 'USER'] } },
      { name: 'status', in: 'query', description: 'Filter by status', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
    ],
    responses: {
      200: {
        description: 'List of users',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                users: { type: 'array', items: { $ref: '#/components/schemas/UserResponse' } },
              },
            },
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users/me'] = {
  get: {
    tags: ['Users'],
    summary: 'Current user profile',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current user',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                user: { $ref: '#/components/schemas/UserResponse' },
              },
            },
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users/{id}'] = {
  get: {
    tags: ['Users'],
    summary: 'Get user by ID (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      200: {
        description: 'User details',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                user: { $ref: '#/components/schemas/UserResponse' },
              },
            },
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  patch: {
    tags: ['Users'],
    summary: 'Update user (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    requestBody: {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateUserRequest' },
        },
      },
    },
    responses: {
      200: {
        description: 'User updated',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                user: { $ref: '#/components/schemas/UserResponse' },
              },
            },
          },
        },
      },
      400: { description: 'No valid fields to update', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Forbidden (cannot update ADMIN)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'email or user_id already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users/{id}/deactivate'] = {
  patch: {
    tags: ['Users'],
    summary: 'Deactivate user (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      200: {
        description: 'User deactivated',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                user: { $ref: '#/components/schemas/UserResponse' },
              },
            },
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/questions'] = {
  post: {
    tags: ['Forms'],
    summary: 'Create form question (Admin only)',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateQuestionRequest' },
        },
      },
    },
    responses: {
      201: { description: 'Question created' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'No active form found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  get: {
    tags: ['Forms'],
    summary: 'List form questions (Admin only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Question list' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/questions/{id}'] = {
  get: {
    tags: ['Forms'],
    summary: 'Get question by ID (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Question detail' },
      400: { description: 'Invalid question id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  patch: {
    tags: ['Forms'],
    summary: 'Update question (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateQuestionRequest' },
        },
      },
    },
    responses: {
      200: { description: 'Question updated' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  delete: {
    tags: ['Forms'],
    summary: 'Delete question (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Question deleted' },
      400: { description: 'Invalid question id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/today'] = {
  get: {
    tags: ['Forms'],
    summary: "Get today's active form questions (User only)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Today form and questions' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'User access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/submissions/today'] = {
  post: {
    tags: ['Forms'],
    summary: "Submit today's answers (User only, once/day)",
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TodaySubmissionRequest' },
        },
      },
    },
    responses: {
      201: { description: 'Submission created' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'User access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'No active form found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'Already submitted today', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/submissions/me/latest'] = {
  get: {
    tags: ['Forms'],
    summary: 'Get latest submission status and answers (User only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Latest submission (or null)' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'User access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/analytics/users'] = {
  get: {
    tags: ['Forms Analytics'],
    summary: 'List users with submission summary (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'search', in: 'query', schema: { type: 'string' } },
      { name: 'q', in: 'query', schema: { type: 'string' } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
      { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
      { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
    ],
    responses: {
      200: { description: 'Users analytics list' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/analytics/users/{userId}/history'] = {
  get: {
    tags: ['Forms Analytics'],
    summary: 'Get one user submission timeline (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
      { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
    ],
    responses: {
      200: { description: 'Detailed user submission history' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

export const swaggerSpec = spec;
export const swaggerUiHandler = swaggerUi.serve;
export const swaggerUiSetup = swaggerUi.setup(spec);
