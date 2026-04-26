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
                crew_type: { type: 'string', nullable: true },
                head_quarter: { type: 'string', nullable: true },
                mobile: { type: 'string', nullable: true },
                profile_image_url: { type: 'string', nullable: true },
              },
            },
          },
        },
        SignupRequest: {
          type: 'object',
          required: ['user_id', 'name', 'password'],
          properties: {
            user_id: { type: 'string', example: 'crew_001' },
            name: { type: 'string', example: 'Ravi Kumar' },
            password: { type: 'string' },
            email: { type: 'string', nullable: true },
            crew_type: { type: 'string', nullable: true },
            head_quarter: { type: 'string', nullable: true },
            mobile: { type: 'string', nullable: true },
          },
        },
        CreateUserRequest: {
          type: 'object',
          required: ['user_id', 'name', 'password'],
          properties: {
            user_id: { type: 'string' },
            name: { type: 'string' },
            password: { type: 'string' },
            email: { type: 'string', nullable: true },
            crew_type: { type: 'string', nullable: true },
            head_quarter: { type: 'string', nullable: true },
            mobile: { type: 'string', nullable: true },
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
            crew_type: { type: 'string', nullable: true },
            head_quarter: { type: 'string', nullable: true },
            mobile: { type: 'string', nullable: true },
            profile_image_url: { type: 'string', nullable: true, description: 'Public URL or presigned GET URL when avatar is set' },
          },
        },
        PatchMeRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            password: { type: 'string' },
            crew_type: { type: 'string', nullable: true },
            head_quarter: { type: 'string', nullable: true },
            mobile: { type: 'string', nullable: true },
          },
        },
        UpdateUserRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            password: { type: 'string' },
            crew_type: { type: 'string', nullable: true },
            head_quarter: { type: 'string', nullable: true },
            mobile: { type: 'string', nullable: true },
            profile_image_key: {
              type: 'string',
              nullable: true,
              description: 'Set to null to clear avatar (removes S3 object when configured)',
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },
        FaceEnrollmentStatusResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            status: {
              type: 'string',
              enum: ['none', 'pending', 'active', 'failed'],
              description: 'none = no enrollment record; otherwise DB status',
            },
            last_error: { type: 'string', nullable: true },
          },
        },
        FaceEnrollSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            status: { type: 'string', example: 'active' },
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
        FormTemplate: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            staff_type: { type: 'string', enum: ['ALP', 'LP', 'TM'] },
            duty_type: { type: 'string', enum: ['SIGN_IN', 'SIGN_OFF'] },
            is_active: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateTemplateRequest: {
          type: 'object',
          required: ['title', 'staffType', 'dutyType'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            staffType: { type: 'string', enum: ['ALP', 'LP', 'TM'] },
            dutyType: { type: 'string', enum: ['SIGN_IN', 'SIGN_OFF'] },
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
          required: ['staffType', 'dutyType', 'answers'],
          properties: {
            staffType: { type: 'string', enum: ['ALP', 'LP', 'TM'] },
            dutyType: { type: 'string', enum: ['SIGN_IN', 'SIGN_OFF'] },
            answers: {
              type: 'array',
              items: { $ref: '#/components/schemas/TodayAnswerItem' },
            },
          },
        },
        TodayQuestionsResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            form: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                description: { type: 'string', nullable: true },
                staff_type: { type: 'string', enum: ['ALP', 'LP', 'TM'] },
                duty_type: { type: 'string', enum: ['SIGN_IN', 'SIGN_OFF'] },
              },
            },
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  prompt: { type: 'string' },
                  is_required: { type: 'boolean' },
                  sort_order: { type: 'integer' },
                },
              },
            },
            submission_date: { type: 'string', format: 'date' },
          },
        },
        TodaySubmissionResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            submission: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                user_id: { type: 'string', format: 'uuid' },
                form_id: { type: 'string', format: 'uuid' },
                submission_date: { type: 'string', format: 'date' },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
            answers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  submission_id: { type: 'string', format: 'uuid' },
                  question_id: { type: 'string', format: 'uuid' },
                  answer_text: { type: 'string' },
                  created_at: { type: 'string', format: 'date-time' },
                  updated_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        RequiredQuestionsErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'All required questions must be answered' },
            missing_required_question_ids: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
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
spec.paths['/api/auth/signup'] = {
  post: {
    tags: ['Auth'],
    summary: 'Self-register (public)',
    description:
      'Creates a USER account in the database (not the legacy KIOSK/MONITOR in-memory register). Returns JWT like login.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/SignupRequest' },
        },
      },
    },
    responses: {
      201: {
        description: 'Account created',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginResponse' },
          },
        },
      },
      400: { description: 'Missing required fields', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'user_id or email already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
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
  patch: {
    tags: ['Users'],
    summary: 'Update current user profile',
    description:
      'Updates name, email, password, crew_type, head_quarter, mobile. Cannot change role, status, user_id, or profile_image_key (use POST /api/users/me/avatar for photo).',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PatchMeRequest' },
        },
      },
    },
    responses: {
      200: {
        description: 'Profile updated',
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
      400: { description: 'No valid fields, forbidden fields, or invalid payload', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'Email conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users/me/avatar'] = {
  post: {
    tags: ['Users'],
    summary: 'Upload profile avatar (current user)',
    description: 'multipart/form-data with field **image** (JPEG, PNG, WebP, or GIF, max 5MB). Requires S3 env configuration on the server.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['image'],
            properties: {
              image: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Avatar updated',
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
      400: { description: 'Missing or invalid file', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      502: { description: 'Upload failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      503: { description: 'Storage not configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users/me/face/status'] = {
  get: {
    tags: ['Users'],
    summary: 'Face enrollment status (current user)',
    description: 'USER role only. Returns none until an enrollment row exists; then pending, active, or failed.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Enrollment state',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/FaceEnrollmentStatusResponse' },
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'USER role required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/users/me/face/enroll'] = {
  post: {
    tags: ['Users'],
    summary: 'Enroll face reference (current user)',
    description:
      'USER role only. multipart/form-data field **image** (JPEG, PNG, WebP, or GIF, max 5MB). Uploads to S3, detects a single face, indexes into AWS Rekognition collection (AWS_REKOGNITION_COLLECTION_ID). Reference image is removed from S3 after successful indexing.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['image'],
            properties: {
              image: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Face indexed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/FaceEnrollSuccessResponse' },
          },
        },
      },
      400: { description: 'No face, multiple faces, or invalid image', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'USER role required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      502: { description: 'Upload or Rekognition error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      503: { description: 'S3 or Rekognition collection not configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
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
spec.paths['/api/users/{id}/avatar'] = {
  post: {
    tags: ['Users'],
    summary: 'Upload user avatar (Admin only)',
    description: 'Same as POST /api/users/me/avatar but for another user (non-ADMIN targets only).',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['image'],
            properties: {
              image: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Avatar updated',
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
      400: { description: 'Missing or invalid file', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required or cannot set ADMIN avatar', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      502: { description: 'Upload failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      503: { description: 'Storage not configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
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
spec.paths['/api/forms/templates'] = {
  post: {
    tags: ['Forms'],
    summary: 'Create form template (Admin only)',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateTemplateRequest' },
        },
      },
    },
    responses: {
      201: { description: 'Template created' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  get: {
    tags: ['Forms'],
    summary: 'List form templates (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'staffType', in: 'query', schema: { type: 'string', enum: ['ALP', 'LP', 'TM'] } },
      { name: 'dutyType', in: 'query', schema: { type: 'string', enum: ['SIGN_IN', 'SIGN_OFF'] } },
      { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
    ],
    responses: {
      200: { description: 'Template list' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/templates/{id}/publish'] = {
  patch: {
    tags: ['Forms'],
    summary: 'Publish template for role-duty pair (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Template published' },
      400: { description: 'Invalid template id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Template not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/templates/{templateId}/questions'] = {
  post: {
    tags: ['Forms'],
    summary: 'Create question under template (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
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
      404: { description: 'Template not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  get: {
    tags: ['Forms'],
    summary: 'List questions under template (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Question list' },
      400: { description: 'Invalid template id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Template not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/templates/{templateId}/questions/{questionId}'] = {
  patch: {
    tags: ['Forms'],
    summary: 'Update template question (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'questionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
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
      404: { description: 'Template or question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  delete: {
    tags: ['Forms'],
    summary: 'Delete template question (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'questionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      200: { description: 'Question deleted' },
      400: { description: 'Invalid id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Template or question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/today'] = {
  get: {
    tags: ['Forms'],
    summary: "Get today's active form questions for staff and duty context (User only)",
    description:
      'Returns questions from the currently active template for the given `staffType` + `dutyType` pair. Pair matching is case-insensitive and normalized to uppercase on the backend.',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'staffType', in: 'query', required: true, schema: { type: 'string', enum: ['ALP', 'LP', 'TM'] } },
      { name: 'dutyType', in: 'query', required: true, schema: { type: 'string', enum: ['SIGN_IN', 'SIGN_OFF'] } },
    ],
    responses: {
      200: {
        description: 'Today form and questions for the requested role+duty pair',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TodayQuestionsResponse' },
          },
        },
      },
      400: { description: 'Missing or invalid staffType/dutyType', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'User access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'No active form found for this context', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/submissions/today'] = {
  post: {
    tags: ['Forms'],
    summary: "Submit today's answers with staff and duty context (User only)",
    description:
      'Creates a submission against the active template for the given `staffType` + `dutyType`. Validates duplicate question answers, active-question membership, and required-question completion for that template.',
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
      201: {
        description: 'Submission created',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TodaySubmissionResponse' },
          },
        },
      },
      400: {
        description:
          'Validation error (examples: invalid enum, empty answers, invalid UUID, duplicate question answers, answer not in active template, required questions missing)',
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { $ref: '#/components/schemas/ErrorResponse' },
                { $ref: '#/components/schemas/RequiredQuestionsErrorResponse' },
              ],
            },
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'User access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'No active form found for this context', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};
spec.paths['/api/forms/submissions/me'] = {
  get: {
    tags: ['Forms'],
    summary: 'My submission history (User only, paginated)',
    description: 'Same submission shape as admin GET /api/forms/analytics/users/{userId}/history, scoped to the authenticated user.',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
      { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
    ],
    responses: {
      200: { description: 'History page with user summary, answers, and pagination' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'User access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
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
      { name: 'userId', in: 'path', required: true, description: 'User UUID id or user_id', schema: { type: 'string' } },
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

spec.paths['/api/auth/device-token'] = {
  post: {
    tags: ['Auth'],
    summary: 'Issue device token (legacy/device clients)',
    description: 'Returns JWT token for KIOSK or MONITOR clients using shared secret.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['deviceId', 'role', 'secret'],
            properties: {
              deviceId: { type: 'string', example: 'KIOSK_01' },
              role: { type: 'string', enum: ['KIOSK', 'MONITOR'] },
              secret: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Device token issued' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Invalid secret', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/auth/register'] = {
  post: {
    tags: ['Auth'],
    summary: 'Legacy register endpoint',
    description: 'Registers in-memory legacy user with userType mapping to KIOSK/MONITOR role.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['username', 'password', 'userType'],
            properties: {
              username: { type: 'string' },
              password: { type: 'string' },
              userType: { type: 'string', enum: ['user', 'monitor'] },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Legacy user registered' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'User already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/auth/users'] = {
  get: {
    tags: ['Auth'],
    summary: 'List legacy in-memory users',
    responses: {
      200: { description: 'Legacy users list' },
    },
  },
};

spec.paths['/api/forms/questions'] = {
  post: {
    tags: ['Forms'],
    summary: 'Create question in active form (Admin only)',
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
      403: { description: 'Division admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  get: {
    tags: ['Forms'],
    summary: 'List questions in active form (Admin only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Question list' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Division admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/forms/questions/{id}'] = {
  get: {
    tags: ['Forms'],
    summary: 'Get one question by id (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Question detail' },
      400: { description: 'Invalid id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  patch: {
    tags: ['Forms'],
    summary: 'Update question by id (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/UpdateQuestionRequest' } },
      },
    },
    responses: {
      200: { description: 'Question updated' },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  delete: {
    tags: ['Forms'],
    summary: 'Delete question by id (Admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Question deleted' },
      400: { description: 'Invalid id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Question not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/forms/analytics/summary'] = {
  get: {
    tags: ['Forms Analytics'],
    summary: 'Submission analytics summary (Admin only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Summary payload' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Division admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/forms/analytics/export/preview'] = {
  get: {
    tags: ['Forms Analytics'],
    summary: 'Preview analytics export data (Admin only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Preview payload' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Division admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/forms/analytics/export'] = {
  get: {
    tags: ['Forms Analytics'],
    summary: 'Export analytics as XLSX (Admin only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'XLSX file stream' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Division admin required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/divisions'] = {
  get: {
    tags: ['Divisions'],
    summary: 'List divisions',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Division list' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Monitor access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  post: {
    tags: ['Divisions'],
    summary: 'Create division (Super admin only)',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    },
    responses: {
      201: { description: 'Division created' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Super admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/divisions/{id}'] = {
  get: {
    tags: ['Divisions'],
    summary: 'Get division by id',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Division detail' },
      404: { description: 'Division not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  patch: {
    tags: ['Divisions'],
    summary: 'Update division (Super admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    },
    responses: {
      200: { description: 'Division updated' },
      403: { description: 'Super admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Division not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/lobbies'] = {
  get: {
    tags: ['Lobbies'],
    summary: 'List lobbies',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Lobby list' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  post: {
    tags: ['Lobbies'],
    summary: 'Create lobby (Division admin only)',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    },
    responses: {
      201: { description: 'Lobby created' },
      403: { description: 'Division admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/lobbies/{id}'] = {
  get: {
    tags: ['Lobbies'],
    summary: 'Get lobby by id',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Lobby detail' },
      404: { description: 'Lobby not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  patch: {
    tags: ['Lobbies'],
    summary: 'Update lobby (Division admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    },
    responses: {
      200: { description: 'Lobby updated' },
      403: { description: 'Division admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Lobby not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  delete: {
    tags: ['Lobbies'],
    summary: 'Delete lobby (Division admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Lobby deleted' },
      403: { description: 'Division admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Lobby not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/devices'] = {
  get: {
    tags: ['Devices'],
    summary: 'List devices',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Device list' },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  post: {
    tags: ['Devices'],
    summary: 'Create device (Division admin only)',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    },
    responses: {
      201: { description: 'Device created' },
      403: { description: 'Division admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/devices/{id}'] = {
  get: {
    tags: ['Devices'],
    summary: 'Get device by id',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Device detail' },
      404: { description: 'Device not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  patch: {
    tags: ['Devices'],
    summary: 'Update device (Division admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    },
    responses: {
      200: { description: 'Device updated' },
      403: { description: 'Division admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  delete: {
    tags: ['Devices'],
    summary: 'Delete device (Division admin only)',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: { description: 'Device deleted' },
      403: { description: 'Division admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
};

spec.paths['/api/health/summary'] = {
  get: {
    tags: ['Health'],
    summary: 'Health summary',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Health summary' } },
  },
};
spec.paths['/api/health/divisions'] = {
  get: {
    tags: ['Health'],
    summary: 'Health grouped by divisions',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Division health list' } },
  },
};
spec.paths['/api/health/lobbies/{id}'] = {
  get: {
    tags: ['Health'],
    summary: 'Health for one lobby',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 200: { description: 'Lobby health detail' } },
  },
};
spec.paths['/api/health/devices/{id}/logs'] = {
  get: {
    tags: ['Health'],
    summary: 'Device health logs',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 200: { description: 'Device logs' } },
  },
};
spec.paths['/api/health/devices/{id}/recover'] = {
  post: {
    tags: ['Health'],
    summary: 'Trigger device recovery',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 200: { description: 'Recovery action accepted/completed' } },
  },
};

spec.paths['/api/analytics/summary'] = {
  get: {
    tags: ['Analytics'],
    summary: 'Monitoring analytics summary',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Summary payload' } },
  },
};
spec.paths['/api/analytics/sla'] = {
  get: {
    tags: ['Analytics'],
    summary: 'SLA metrics',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'SLA payload' } },
  },
};
spec.paths['/api/analytics/divisions'] = {
  get: {
    tags: ['Analytics'],
    summary: 'Division analytics',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Division analytics payload' } },
  },
};
spec.paths['/api/analytics/lobbies/{id}'] = {
  get: {
    tags: ['Analytics'],
    summary: 'Lobby analytics',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 200: { description: 'Lobby analytics payload' } },
  },
};
spec.paths['/api/analytics/devices/{id}'] = {
  get: {
    tags: ['Analytics'],
    summary: 'Device analytics',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 200: { description: 'Device analytics payload' } },
  },
};
spec.paths['/api/analytics/incidents'] = {
  get: {
    tags: ['Analytics'],
    summary: 'Incident analytics',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Incident list/summary payload' } },
  },
};
spec.paths['/api/analytics/autoheal'] = {
  get: {
    tags: ['Analytics'],
    summary: 'Auto-heal analytics',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Auto-heal payload' } },
  },
};

spec.paths['/health'] = {
  get: {
    tags: ['System'],
    summary: 'Server health check',
    responses: {
      200: {
        description: 'Service is healthy',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
                timestamp: { type: 'string', format: 'date-time' },
                service: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

export const swaggerSpec = spec;
export const swaggerUiHandler = swaggerUi.serve;
export const swaggerUiSetup = swaggerUi.setup(spec);
