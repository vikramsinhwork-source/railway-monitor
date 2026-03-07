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

export const swaggerSpec = spec;
export const swaggerUiHandler = swaggerUi.serve;
export const swaggerUiSetup = swaggerUi.setup(spec);
