<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

## Browser authentication

Native/programmatic clients continue to use `/api/v1/auth/register`, `login`, `refresh`, and `logout`; their token-body contract is unchanged. Browser clients use `/api/v1/auth/web/register`, `login`, `refresh`, and `logout`. Browser login and registration return the short-lived access token in JSON and set the opaque refresh token only in the `signvault_refresh` HttpOnly cookie. Browser refresh reads that cookie, rotates it, and returns only a new access token. The cookie is host-only by default, scoped to `/api/v1/auth/web`, and expires with the server-side refresh session.

The browser refresh cookie defaults to `SameSite=Lax`, which supports the local `localhost:3000` to `localhost:4000` setup and same-site production subdomains. Set `AUTH_COOKIE_SAME_SITE=none` only when the frontend and API are genuinely cross-site; this forces `Secure`. Cookies are always `Secure` in production. `AUTH_COOKIE_DOMAIN` is optional and should name only the exact deployment host/domain needed. `FRONTEND_URL` is the sole allowed CORS origin and is also checked against the `Origin` header for all browser auth operations, including login, registration, refresh, and logout. Missing and unexpected origins are rejected. This Origin check protects cookie-authenticated requests from cross-site request forgery; it is not a replacement for XSS defenses.

The web client should keep access tokens in memory only. After a page reload, it should call `/api/v1/auth/web/refresh` with credentials to restore a short-lived access token; no browser token persistence is needed. The backend never returns the browser refresh token in JSON.

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Database development

Set `DATABASE_URL` in the API repository's local `.env` file to the Neon PostgreSQL connection string. Keep the value private; `.env.example` contains no credentials.

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init_signvault_core
npm run prisma:studio
```

Prisma migrations require a valid `DATABASE_URL`. Do not use `prisma db push` as a substitute for migrations. Prisma Studio is intended for local development and should not be exposed publicly.

Run the API with `npm run start:dev`. Run unit and E2E tests with `npm test` and `npm run test:e2e`; those test suites should not require a live Neon database.

## Signature versions

Creating a signature creates only its profile. Create its first visual version separately with `POST /api/v1/signatures/:signatureId/versions`. Designer configuration is validated structured JSON: styles are `CLASSIC`, `ELEGANT`, `MODERN`, or `MINIMAL`, and font families are restricted to the built-in identifiers in the API DTO. Arbitrary CSS, scripts, and remote font URLs are not accepted.

Saved versions are immutable. Use `POST /api/v1/signatures/:signatureId/versions/:versionId/duplicate` to create a new version from saved designer data. Version numbers are assigned while holding a PostgreSQL transaction-scoped advisory lock for the parent signature, with the unique `(signatureId, versionNumber)` constraint as a database guard. The first version is selected automatically; use `PUT /api/v1/signatures/:signatureId/versions/:versionId/current` to select another version.

Archiving a version is soft: it preserves designer data and historical references. Archiving the current version clears the current selection; archived versions cannot be selected or duplicated. Full history is available from `GET /api/v1/signatures/:signatureId/versions`; signature detail and vault list responses include only the current-version preview and version count.

## Signature visual assets

The validated `SignatureVersion` designer JSON remains the editable source of truth. `POST /api/v1/signatures/:signatureId/versions/:versionId/render` renders only that saved version into a server-generated canonical SVG and stores it in Neon Object Storage. The renderer accepts allowlisted fonts and numeric properties, escapes display text, emits no client-provided markup, stylesheets, scripts, images, or external references, and keeps the background transparent. Canonical SVG font-family values remain generic/fallback names so browser rendering is unchanged and still depends on the viewer's fonts.

SVG objects use deterministic server-generated keys and SHA-256 checksums for integrity/consistency checks only. This checksum is not a document hash or digital signature. Re-rendering identical saved data reuses the same object and updates metadata only if needed. SVG is served through authenticated API routes from a private bucket; permanent public URLs and object keys are not returned. Archived versions and signatures retain their objects.

PNG is an on-demand transparent derivative of the stored canonical SVG, rasterized with the pinned `@resvg/resvg-js` renderer at fixed 1200x300 dimensions and scale presets 1x, 2x, or 3x. System-font loading is disabled. The PNG-only rasterizer maps `serif` to bundled Noto Serif, `script` and `modern-script` to bundled Caveat, and `sans-serif` to bundled Noto Sans. These font files and their SIL Open Font License notices are included under `src/signatures/fonts` and copied into the production build; PNG rendering does not depend on host fontconfig or operating-system fonts. PNG derivatives are not persisted. SVG and PNG exports are available through `GET /api/v1/signatures/:signatureId/versions/:versionId/export?format=svg|png`; the dedicated `/asset` route returns the unchanged canonical SVG.

### Neon Object Storage configuration

Create a **private** bucket for the API's Neon project branch and a branch-scoped Neon credential with `storage:read` and `storage:write` scopes. Neon currently documents the AWS S3-compatible API; the backend uses `@aws-sdk/client-s3` with path-style addressing. Configure these values in the API's local `.env` or deployment secret store only:

- `AWS_ENDPOINT_URL_S3`: the branch storage endpoint from Neon
- `AWS_ACCESS_KEY_ID`: Neon credential `token_id`
- `AWS_SECRET_ACCESS_KEY`: Neon credential `s3_secret_access_key`
- `AWS_REGION`: the branch storage region
- `NEON_OBJECT_STORAGE_BUCKET`: the private bucket name

Blank placeholders are listed in `.env.example`. Do not commit credentials or put them in the web or mobile applications. When these values are absent, API startup and unrelated endpoints still work; asset operations return a generic storage-unavailable error. No live storage is used by unit or E2E tests: the provider is mocked. Provisioning the bucket and credentials is a manual Neon Console/CLI step.

The checked-in migration adds the asset checksum column and render audit enum value. Apply it with `npx prisma migrate deploy` only after verifying `DATABASE_URL` targets the intended database. The migration was not applied as part of this implementation.

SVG/PNG files are visual representations only. They do not prove document integrity and are not cryptographic digital signatures; inserting an image into a document does not make that document tamper-proof.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
