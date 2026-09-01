# SIIT ICT Resource Request System

A full-stack web application for SIIT students to submit ICT/resource requests and for authorized reviewers to review and manage them.

## Technology Stack

- **Frontend**: React + JavaScript + Vite + React Router
- **Backend**: Node.js + Express + JavaScript
- **Database**: MySQL 8
- **ORM**: Prisma
- **Authentication**: Google OAuth 2.0 + OpenID Connect
- **Containerization**: Docker & Docker Compose
- **Validation**: Zod
- **Deployment**: AWS ECS Fargate (production)

## Project Structure

```
.
├── backend/                    # Express.js API
│   ├── prisma/                # Prisma schema
│   ├── src/
│   │   ├── routes/           # API routes
│   │   ├── controllers/       # Request handlers
│   │   ├── services/          # Business logic
│   │   ├── middleware/        # Authentication & error handling
│   │   ├── auth/              # Google OAuth
│   │   ├── utils/             # Validation schemas
│   │   ├── config/            # Configuration
│   │   ├── lib/               # Prisma client
│   │   ├── app.js             # Express app
│   │   └── server.js          # Server entry point
│   ├── package.json
│   └── Dockerfile
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── api/               # API client modules
│   │   ├── pages/             # Page components
│   │   ├── styles/            # CSS files
│   │   ├── App.jsx            # Main app with routing
│   │   └── main.jsx           # Entry point
│   ├── package.json
│   └── Dockerfile
├── database/
│   ├── init.sql               # MySQL schema
│   └── README.md
├── docker-compose.yml         # Local development setup
└── README.md

```

## Quick Start with Docker Compose

### Prerequisites

- Docker & Docker Compose installed
- Google OAuth 2.0 credentials

### Setup

1. **Clone and Navigate**
   ```bash
   cd SIIT-ICT-Server-Management
   ```

2. **Configure Environment**
   ```bash
   # Backend
   cp backend/.env.example backend/.env
   # Edit backend/.env and add Google OAuth credentials
   
   # Frontend
   cp frontend/.env.example frontend/.env
   ```

3. **Start Services**
   ```bash
   docker-compose up --build
   ```

4. **Access Application**
   - Frontend: `http://localhost:5173`
   - Backend API: `http://localhost:3000`
   - Database: `localhost:3306`

## Local Development Setup

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Configure database connection
# Update DATABASE_URL in .env

# Generate Prisma client
npx prisma db pull
npx prisma generate

# Start development server
npm run dev
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Start development server
npm run dev
```

## API Documentation

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/google` | Initiate Google OAuth flow |
| GET | `/api/auth/google/callback` | OAuth callback handler |
| GET | `/api/auth/me` | Get current authenticated user |
| POST | `/api/auth/logout` | Logout and destroy session |

### User Profile Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/me` | Get user profile |
| POST | `/api/users/me` | Create user profile |
| PATCH | `/api/users/me` | Update user profile |

### Student Request Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/requests` | Create new resource request |
| GET | `/api/requests/me` | Get authenticated user's requests |
| GET | `/api/requests/:id` | Get specific request details |
| PATCH | `/api/requests/:id` | Update pending request |

### Reviewer Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reviewer/requests` | List all requests (with filtering) |
| GET | `/api/reviewer/requests/:id` | Get request details for review |
| PATCH | `/api/reviewer/requests/:id/approve` | Approve a pending request |
| PATCH | `/api/reviewer/requests/:id/reject` | Reject a pending request |
| PATCH | `/api/reviewer/requests/:id/activate` | Activate an approved request |
| PATCH | `/api/reviewer/requests/:id/complete` | Mark request as completed |

## Database Schema

### accounts
Main account/profile table for all users

```sql
CREATE TABLE accounts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  google_sub VARCHAR(255) UNIQUE NOT NULL,
  primary_email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(30),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### users
Student-specific profile information

```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  account_id BIGINT UNIQUE NOT NULL,
  student_id VARCHAR(30) UNIQUE NOT NULL,
  degree ENUM('UNDERGRADUATE', 'MASTER', 'DOCTORAL'),
  program VARCHAR(255),
  advisor_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
```

### resource_requests
Main request information

```sql
CREATE TABLE resource_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  purpose VARCHAR(255),
  project_description TEXT,
  project_supervisor_name VARCHAR(255),
  resource_type ENUM(...),
  justification TEXT,
  estimated_start_date DATE,
  estimated_end_date DATE,
  impact_score TINYINT CHECK (impact_score BETWEEN 1 AND 10),
  supervisor_confirmation ENUM('CONFIRMED', 'NOT_CONFIRMED'),
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'COMPLETED') DEFAULT 'PENDING',
  reviewed_by_account_id BIGINT,
  reviewed_at TIMESTAMP NULL,
  review_comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
```

### Resource-Specific Tables
Each resource type has a detail table:
- `hpc_gpu_requests`
- `big_data_requests`
- `vm_requests`
- `lab_equipment_requests`
- `aws_skill_builder_requests`
- `aws_learner_lab_requests`

## Features

### Student Portal
✅ Google OAuth authentication
✅ Profile completion
✅ Submit resource requests
✅ View and edit pending requests
✅ Track request status
✅ Review comments from reviewers

### Reviewer Dashboard
✅ View all requests
✅ Filter by status, resource type, student
✅ Approve/reject with comments
✅ Activate and complete requests
✅ Enforce state transitions

### Security
✅ Google OAuth 2.0 verification
✅ Server-side sessions
✅ HttpOnly secure cookies
✅ CORS protection
✅ Parameterized queries
✅ Input validation (Zod)
✅ Backend authorization

## Request Status Workflow

```
PENDING
├→ APPROVED (reviewer)
│  └→ ACTIVE (reviewer)
│     └→ COMPLETED (reviewer)
└→ REJECTED (reviewer)
```

## Resource Types

- **HPC GPU** - High-Performance Computing / GPU Cluster Access
- **Big Data** - Big Data Platform / Server Access
- **VM** - Virtual Machine
- **Lab Equipment** - Specialized Laboratory Equipment
- **AWS Skill Builder** - AWS Skill Builder Training Course
- **AWS Learner Lab** - AWS Learner Lab

## Environment Variables

### Backend (.env)

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://root:password@mysql:3306/siit_resource
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
SESSION_SECRET=dev-secret-change-in-production
FRONTEND_URL=http://localhost:5173
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:3000
```

## Testing

Run backend tests:

```bash
cd backend
npm test
```

Tests cover:
- Account creation/lookup
- Profile management
- Request lifecycle
- State transitions
- Authorization

## Production Deployment

### AWS ECS Fargate Deployment

1. **Prepare Images**
   ```bash
   # Build and push to ECR
   aws ecr get-login-password | docker login --username AWS --password-stdin <registry>
   docker tag siit-backend <registry>/siit-backend:latest
   docker push <registry>/siit-backend:latest
   docker tag siit-frontend <registry>/siit-frontend:latest
   docker push <registry>/siit-frontend:latest
   ```

2. **Create ECS Services**
   - Backend task definition (port 3000)
   - Frontend task definition (port 5173)
   - Auto-scaling policies

3. **Configure RDS MySQL**
   - Create MySQL 8 database
   - Run initialization script
   - Configure security groups

4. **Set Up Application Load Balancer**
   - Create ALB
   - Configure routing rules
   - Attach SSL certificate

5. **Environment Configuration**
   - Update production environment variables
   - Enable HTTPS
   - Configure CloudFront CDN

## Development Commands

### Backend

```bash
npm run dev        # Start development server
npm run start      # Start production server
npm run test       # Run tests
npm run test:watch # Run tests in watch mode
npx prisma db pull # Sync Prisma with database
npx prisma generate # Generate Prisma client
```

### Frontend

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run lint       # Run linter
npm run preview    # Preview production build
```

## Troubleshooting

### MySQL Connection Issues
```bash
docker exec siit_mysql mysql -uroot -ppassword -h localhost siit_resource -e "SHOW TABLES;"
```

### Prisma Issues
```bash
npx prisma generate
npx prisma db push
```

### Frontend/Backend Connection
- Verify `VITE_API_URL` environment variable
- Check CORS settings in backend (`FRONTEND_URL`)
- Inspect browser console for errors

### Google OAuth Issues
- Verify Client ID and Secret
- Check OAuth callback URL matches configuration
- Ensure email is verified on Google account

## License

MIT

## Support

For issues or questions, please contact the development team or open a GitHub issue.

