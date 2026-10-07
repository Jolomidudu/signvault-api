   this is for the backend folder/repo (signvault-api) IMPORTANT PROJECT CONTEXT
   
   We are building SignVault, a full-stack application consisting of two separate repositories:
   
   1. signvault-web
      
      - Frontend development URL: http://localhost:3000
   
   2. signvault-api
      - NestJS backend
      - TypeScript
      - REST API
      - Backend development URL: http://localhost:4000
      - This is the repository you are currently working on.
   
   IMPORTANT:
   WORK ONLY INSIDE THE signvault-api REPOSITORY/FOLDER.
   
   DO NOT MODIFY signvault-web.
   
   The frontend and backend are separate Git repositories but belong to the same SignVault product.
   
   ==================================================
   PRODUCT DEFINITION
   ==================================================
   
   SignVault is NOT a document management platform.
   
   SignVault is a secure digital signature vault and cryptographic signature management platform.
   
   The primary object in SignVault is the user's digital signature.
   
   Users should eventually be able to:
   
   - Create multiple signature profiles
   - Customize signatures
   - Store signatures securely
   - Create signature versions
   - Copy signatures
   - Export signatures
   - Share signatures
   - Use signatures in other applications
   - Set expiration rules
   - Revoke signatures
   - View signature history
   - Track signature usage
   - Cryptographically sign supported files
   - Verify signatures
   - Detect whether a signed file has been altered
   - Use timestamps
   - View verification records
   
   The existing SignVault Figma/mobile design is the product reference.
   
   The web frontend is being built separately in signvault-web.
   
   The backend must provide a clean REST API that can eventually serve BOTH:
   
   - Next.js web application
   - Flutter mobile application
   
   ==================================================
   BACKEND TECHNOLOGY
   ==================================================
   
   Use:
   
   - NestJS
   - TypeScript
   - REST API
   - Prisma ORM
   - PostgreSQL
   - Neon PostgreSQL
   - JWT authentication
   - Secure password hashing
   - DTO validation
   - Swagger/OpenAPI
   - Environment variables
   - Jest for testing
   
   Future infrastructure:
   
   - Railway for backend hosting
   - Neon PostgreSQL for database
   - Neon Object Storage for signature assets and supported files
   
   Do not implement the advanced cryptographic signing system yet.
   
   We will build that later as a dedicated phase.
   
   ==================================================
   CURRENT PHASE
   ==================================================
   
   This is BACKEND PHASE 1.
   
   The purpose of this phase is to establish a clean, production-oriented NestJS foundation.
   
   DO NOT implement all of SignVault at once.
   
   DO NOT implement authentication yet.
   
   DO NOT implement Prisma/database yet.
   
   DO NOT implement Neon yet.
   
   DO NOT implement Object Storage yet.
   
   DO NOT implement cryptographic signing yet.
   
   DO NOT implement signature management yet.
   
   DO NOT create fake database logic.
   
   Only establish the backend foundation.
   
   ==================================================
   API CONFIGURATION
   ==================================================
   
   The backend must run on:
   
   http://localhost:4000
   
   Use an environment variable for the port:
   
   PORT=4000
   
   The API must use this prefix:
   
   /api/v1
   
   Therefore a health endpoint should eventually be:
   
   GET http://localhost:4000/api/v1/health
   
   ==================================================
   ENVIRONMENT CONFIGURATION
   ==================================================
   
   Set up proper environment configuration.
   
   Create:
   
   .env
   
   and:
   
   .env.example
   
   Do not put secrets directly into TypeScript source files.
   
   The .env.example should contain placeholders only.
   
   Initially support:
   
   PORT=4000
   NODE_ENV=development
   FRONTEND_URL=http://localhost:3000
   
   Do not put real secrets into .env.example.
   
   Make sure .env is ignored by Git.
   
   ==================================================
   CORS
   ==================================================
   
   Configure CORS so the Next.js frontend can communicate with the backend during development.
   
   Allow:
   
   http://localhost:3000
   
   Use the FRONTEND_URL environment variable instead of hardcoding the production URL.
   
   Design this so production can later use something like:
   
   https://signvault.com
   
   without changing application code.
   
   ==================================================
   GLOBAL VALIDATION
   ==================================================
   
   Configure NestJS global validation using:
   
   ValidationPipe
   
   Enable appropriate options such as:
   
   - whitelist
   - forbidNonWhitelisted
   - transform
   
   The API must validate incoming request DTOs.
   
   ==================================================
   API VERSIONING
   ==================================================
   
   Configure API versioning appropriately.
   
   The main API route structure must use:
   
   /api/v1
   
   Keep the architecture ready for future versions such as:
   
   /api/v2
   
   Do not break the standard NestJS conventions unnecessarily.
   
   ==================================================
   HEALTH CHECK
   ==================================================
   
   Create a health module or clean health controller.
   
   Endpoint:
   
   GET /api/v1/health
   
   Return a simple structured response such as:
   
   {
     "success": true,
     "service": "signvault-api",
     "status": "healthy"
   }
   
   Do not connect to the database yet.
   
   The purpose is only to confirm that the API is alive.
   
   ==================================================
   ERROR HANDLING
   ==================================================
   
   Create a consistent error response strategy.
   
   API errors should be structured and predictable.
   
   For example:
   
   {
     "success": false,
     "statusCode": 404,
     "message": "Resource not found",
     "error": "NOT_FOUND",
     "timestamp": "...",
     "path": "/api/v1/..."
   }
   
   Do not expose stack traces or sensitive internal information in production responses.
   
   Use appropriate HTTP status codes.
   
   ==================================================
   SECURITY FOUNDATION
   ==================================================
   
   Prepare the backend for secure production use.
   
   Implement appropriate basic security configuration.
   
   Consider:
   
   - CORS
   - HTTP security headers where appropriate
   - Request validation
   - Proper error handling
   - No secrets in source code
   - No sensitive data in logs
   
   Do not add unnecessary security packages unless they are actually required.
   
   Do not implement authentication yet.
   
   ==================================================
   SWAGGER / OPENAPI
   ==================================================
   
   Configure Swagger/OpenAPI documentation.
   
   Swagger should be available during development at a sensible route such as:
   
   /api/docs
   
   The documentation should use the API version structure.
   
   Add a basic API title:
   
   SignVault API
   
   Description:
   
   Secure digital signature vault and cryptographic signature management API.
   
   Version:
   
   1.0
   
   Do not document functionality that does not exist yet.
   
   ==================================================
   PROJECT ARCHITECTURE
   ==================================================
   
   Keep the NestJS application modular.
   
   The current project should have a clean structure that can later grow into:
   
   src/
     auth/
     users/
     signatures/
     signature-versions/
     crypto/
     verification/
     revocations/
     audit/
     storage/
     security/
     health/
     common/
     prisma/
   
   Do NOT create all of these modules yet.
   
   For this phase, create only the modules/components actually needed for the foundation.
   
   Do not create empty modules just for the sake of creating folders.
   
   ==================================================
   COMMON ARCHITECTURE
   ==================================================
   
   Create a sensible common structure for reusable backend functionality.
   
   Potential structure:
   
   src/common/
     decorators/
     filters/
     guards/
     interceptors/
     pipes/
     types/
     constants/
   
   Only create files that are actually needed at this stage.
   
   Avoid unnecessary abstraction.
   
   ==================================================
   RESPONSE FORMAT
   ==================================================
   
   Establish a consistent response approach where appropriate.
   
   For successful health responses, use:
   
   {
     "success": true,
     "data": {...}
   }
   
   For errors:
   
   {
     "success": false,
     "message": "...",
     "error": "..."
   }
   
   Do not over-engineer this with unnecessary generic wrappers if NestJS's standard response behavior is sufficient.
   
   ==================================================
   LOGGING
   ==================================================
   
   Use NestJS logging appropriately.
   
   Do not log:
   
   - Passwords
   - JWT secrets
   - API keys
   - Private keys
   - Sensitive user information
   
   Prepare the architecture so structured logging can be improved later.
   
   ==================================================
   NESTJS OBSERVE
   ==================================================
   
   The project was created with @nestjs/observe enabled.
   
   Do not require Observe credentials during local development.
   
   Do not invent Observe credentials.
   
   Do not put Observe secrets into source code.
   
   Leave the existing integration in a safe state unless changes are required for the application to compile and run.
   
   We can configure Observe later if needed for production monitoring.
   
   ==================================================
   TESTING
   ==================================================
   
   Keep the existing Jest setup.
   
   Create or update tests for:
   
   - Health endpoint
   - Basic application startup where appropriate
   
   Do not create large numbers of tests for functionality that has not been implemented.
   
   ==================================================
   CODE QUALITY
   ==================================================
   
   Use:
   
   - TypeScript strict typing
   - Clean naming
   - Small focused modules
   - NestJS conventions
   - Dependency injection
   - DTOs
   - Meaningful comments only where necessary
   
   Do not create giant files.
   
   Do not duplicate logic.
   
   Do not introduce unnecessary dependencies.
   
   Do not change unrelated generated files unless necessary.
   
   ==================================================
   IMPORTANT FUTURE ARCHITECTURE
   ==================================================
   
   The backend will eventually contain these major areas:
   
   AUTHENTICATION
   
   Users
   Registration
   Login
   JWT
   Refresh tokens
   Password reset
   Email verification
   Role-based authorization
   
   SIGNATURE MANAGEMENT
   
   Signature profiles
   Signature versions
   Signature assets
   Signature status
   Signature expiration
   Signature revocation
   Signature usage
   
   CRYPTOGRAPHY
   
   Cryptographic key generation
   Private key protection
   Public key management
   File hashing
   Digital signatures
   Timestamping
   Signature verification
   
   DOCUMENT/FILE INTEGRITY
   
   File hash
   Signed hash
   Verification status
   Tamper detection
   
   AUDIT
   
   Signature events
   Verification events
   Revocation events
   Security events
   
   STORAGE
   
   Neon Object Storage
   
   IMPORTANT:
   
   Do not implement these advanced systems in this phase.
   
   The architecture should simply remain clean enough that they can be added later.
   
   ==================================================
   DEVELOPMENT RULE
   ==================================================
   
   Work incrementally.
   
   Before changing files:
   
   1. Inspect the existing NestJS project.
   2. Reuse the existing generated structure where appropriate.
   3. Do not unnecessarily rewrite the project.
   4. Do not modify signvault-web.
   
   After implementation:
   
   1. Run TypeScript compilation.
   2. Run lint.
   3. Run tests.
   4. Start the development server.
   5. Verify:
      http://localhost:4000/api/v1/health
   6. Verify Swagger:
      http://localhost:4000/api/docs
   7. Fix any errors you encounter.
   
   At the end, provide a concise summary of:
   - Files created
   - Files modified
   - Packages installed
   - Commands run
   - Any remaining issues
   
   Do not proceed to Phase 2.
   
   STOP after the backend foundation is complete.