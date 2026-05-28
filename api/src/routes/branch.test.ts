import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import branchRouter from './branch';
import { runMigrations } from '../db/migrate';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { errorHandler } from '../utils/errors';

let app: express.Express;

describe('Branch API', () => {
  beforeEach(async () => {
    // Ensure a fresh in-memory database for each test
    await closeDatabase();
    await getDatabase(true);
    await runMigrations(true);

    // Seed required foreign key: headquarters id 1
    const db = await getDatabase();
    await db.run('INSERT INTO headquarters (headquarters_id, name) VALUES (?, ?)', [1, 'HQ One']);

    // Set up express app
    app = express();
    app.use(express.json());
    app.use('/branches', branchRouter);
    // Attach error handler to translate repo errors
    app.use(errorHandler);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('should create a new branch', async () => {
    const newBranch = {
      headquartersId: 1,
      name: 'Eastside Branch',
      description: 'Eastern district branch',
      address: '321 East St',
      contactPerson: 'Emma Davis',
      email: 'edavis@octo.com',
      phone: '555-0203',
    };
    const response = await request(app).post('/branches').send(newBranch);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject(newBranch);
    expect(response.body.branchId).toBeDefined();
  });

  it('should get all branches', async () => {
    const response = await request(app).get('/branches');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should get a branch by ID', async () => {
    // First create a branch to test getting it
    const newBranch = {
      headquartersId: 1,
      name: 'Test Branch',
      description: 'Test branch',
      address: '123 Test St',
      contactPerson: 'Test Person',
      email: 'test@test.com',
      phone: '555-0000',
    };
    const createResponse = await request(app).post('/branches').send(newBranch);
    const branchId = createResponse.body.branchId;

    const response = await request(app).get(`/branches/${branchId}`);
    expect(response.status).toBe(200);
    expect(response.body.branchId).toBe(branchId);
  });

  it('should update a branch by ID', async () => {
    // First create a branch to test updating it
    const newBranch = {
      headquartersId: 1,
      name: 'Original Branch',
      description: 'Original description',
      address: '123 Original St',
      contactPerson: 'Original Person',
      email: 'original@test.com',
      phone: '555-0001',
    };
    const createResponse = await request(app).post('/branches').send(newBranch);
    const branchId = createResponse.body.branchId;

    const updatedBranch = {
      ...newBranch,
      name: 'Updated Branch Name',
    };
    const response = await request(app).put(`/branches/${branchId}`).send(updatedBranch);
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Updated Branch Name');
  });

  it('should delete a branch by ID', async () => {
    // First create a branch to test deleting it
    const newBranch = {
      headquartersId: 1,
      name: 'Delete Me Branch',
      description: 'This branch will be deleted',
      address: '123 Delete St',
      contactPerson: 'Delete Person',
      email: 'delete@test.com',
      phone: '555-9999',
    };
    const createResponse = await request(app).post('/branches').send(newBranch);
    const branchId = createResponse.body.branchId;

    const response = await request(app).delete(`/branches/${branchId}`);
    expect(response.status).toBe(204);
  });

  it('should return 404 for non-existing branch', async () => {
    const response = await request(app).get('/branches/999');
    expect(response.status).toBe(404);
  });

  it('should return 404 when updating a non-existing branch', async () => {
    const response = await request(app).put('/branches/999').send({
      headquartersId: 1,
      name: 'Ghost Branch',
      description: 'Does not exist',
      address: '404 Nowhere',
      contactPerson: 'Nobody',
      email: 'nobody@test.com',
      phone: '555-0404',
    });
    expect(response.status).toBe(404);
    expect(response.text).toBe('Branch not found');
  });

  it('should return 404 when deleting a non-existing branch', async () => {
    const response = await request(app).delete('/branches/999');
    expect(response.status).toBe(404);
    expect(response.text).toBe('Branch not found');
  });

  it('should surface FK constraint violations through the error handler when creating a branch', async () => {
    // Enable FK enforcement so SQLite raises a FK constraint error for an unknown headquarters
    const db = await getDatabase();
    await db.run('PRAGMA foreign_keys = ON');

    const invalidBranch = {
      headquartersId: 9999, // Non-existent FK
      name: 'Orphan Branch',
      description: 'Bad FK',
      address: '123 Orphan St',
      contactPerson: 'Orphan',
      email: 'orphan@test.com',
      phone: '555-0000',
    };
    const response = await request(app).post('/branches').send(invalidBranch);
    // The repository wraps the raw SQLite error in a generic DatabaseError (500),
    // which the errorHandler middleware exposes with code DATABASE_ERROR.
    expect(response.status).toBe(500);
    expect(response.body?.error?.code).toBe('DATABASE_ERROR');
    expect(response.body?.error?.message).toMatch(/FOREIGN KEY|constraint/i);
  });

  it('should propagate unexpected errors via the error handler on GET all', async () => {
    // Drop the branches table to force a DB error on findAll -> next(error)
    const db = await getDatabase();
    await db.run('DROP TABLE branches');

    const response = await request(app).get('/branches');
    expect(response.status).toBe(500);
    expect(response.body?.error?.code).toBe('DATABASE_ERROR');
  });

  it('should propagate unexpected errors via the error handler on GET by ID', async () => {
    const db = await getDatabase();
    await db.run('DROP TABLE branches');

    const response = await request(app).get('/branches/1');
    expect(response.status).toBe(500);
    expect(response.body?.error?.code).toBe('DATABASE_ERROR');
  });

  it('should propagate unexpected errors via the error handler on POST', async () => {
    const db = await getDatabase();
    await db.run('DROP TABLE branches');

    const response = await request(app).post('/branches').send({
      headquartersId: 1,
      name: 'Broken Branch',
      description: 'No table',
      address: '500 Error Rd',
      contactPerson: 'Boom',
      email: 'boom@test.com',
      phone: '555-0500',
    });
    expect(response.status).toBe(500);
    expect(response.body?.error?.code).toBe('DATABASE_ERROR');
  });
});

describe('BranchesRepository (integration)', () => {
  beforeEach(async () => {
    await closeDatabase();
    await getDatabase(true);
    await runMigrations(true);

    const db = await getDatabase();
    await db.run('INSERT INTO headquarters (headquarters_id, name) VALUES (?, ?)', [1, 'HQ One']);
    await db.run('INSERT INTO headquarters (headquarters_id, name) VALUES (?, ?)', [2, 'HQ Two']);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('exists() returns true for an existing branch and false otherwise', async () => {
    const { getBranchesRepository } = await import('../repositories/branchesRepo');
    const repo = await getBranchesRepository(true);
    const created = await repo.create({
      headquartersId: 1,
      name: 'Exists Branch',
      description: 'd',
      address: 'a',
      contactPerson: 'c',
      email: 'e@test.com',
      phone: 'p',
    });

    expect(await repo.exists(created.branchId!)).toBe(true);
    expect(await repo.exists(987654)).toBe(false);
  });

  it('findByHeadquartersId() returns only branches for the given HQ', async () => {
    const { getBranchesRepository } = await import('../repositories/branchesRepo');
    const repo = await getBranchesRepository(true);
    await repo.create({
      headquartersId: 1, name: 'HQ1-A', description: '', address: '', contactPerson: '', email: '', phone: '',
    });
    await repo.create({
      headquartersId: 1, name: 'HQ1-B', description: '', address: '', contactPerson: '', email: '', phone: '',
    });
    await repo.create({
      headquartersId: 2, name: 'HQ2-A', description: '', address: '', contactPerson: '', email: '', phone: '',
    });

    const hq1 = await repo.findByHeadquartersId(1);
    const hq2 = await repo.findByHeadquartersId(2);

    expect(hq1).toHaveLength(2);
    expect(hq1.every((b) => b.headquartersId === 1)).toBe(true);
    expect(hq2).toHaveLength(1);
    expect(hq2[0].name).toBe('HQ2-A');
  });

  it('findByName() returns branches matching a partial name (case-insensitive LIKE)', async () => {
    const { getBranchesRepository } = await import('../repositories/branchesRepo');
    const repo = await getBranchesRepository(true);
    await repo.create({
      headquartersId: 1, name: 'Downtown Hub', description: '', address: '', contactPerson: '', email: '', phone: '',
    });
    await repo.create({
      headquartersId: 1, name: 'Uptown Hub', description: '', address: '', contactPerson: '', email: '', phone: '',
    });
    await repo.create({
      headquartersId: 1, name: 'Suburb Outlet', description: '', address: '', contactPerson: '', email: '', phone: '',
    });

    const hubs = await repo.findByName('Hub');
    expect(hubs).toHaveLength(2);
    expect(hubs.map((b) => b.name).sort()).toEqual(['Downtown Hub', 'Uptown Hub']);

    const none = await repo.findByName('Nonexistent');
    expect(none).toEqual([]);
  });

  it('delete() removes a branch and exists() reflects the change', async () => {
    const { getBranchesRepository } = await import('../repositories/branchesRepo');
    const repo = await getBranchesRepository(true);
    const created = await repo.create({
      headquartersId: 1, name: 'To Delete', description: '', address: '', contactPerson: '', email: '', phone: '',
    });

    expect(await repo.exists(created.branchId!)).toBe(true);
    await repo.delete(created.branchId!);
    expect(await repo.exists(created.branchId!)).toBe(false);
  });

  it('update() throws NotFoundError for a missing branch', async () => {
    const { getBranchesRepository } = await import('../repositories/branchesRepo');
    const { NotFoundError } = await import('../utils/errors');
    const repo = await getBranchesRepository(true);

    await expect(repo.update(424242, { name: 'Nope' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete() throws NotFoundError for a missing branch', async () => {
    const { getBranchesRepository } = await import('../repositories/branchesRepo');
    const { NotFoundError } = await import('../utils/errors');
    const repo = await getBranchesRepository(true);

    await expect(repo.delete(424242)).rejects.toBeInstanceOf(NotFoundError);
  });
});
