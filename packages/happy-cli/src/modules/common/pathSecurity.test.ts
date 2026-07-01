import { describe, it, expect } from 'vitest';
import { validatePath } from './pathSecurity';

describe('validatePath', () => {
    const workingDir = '/home/user/project';

    it('should allow paths within working directory', () => {
        expect(validatePath('/home/user/project/file.txt', workingDir).valid).toBe(true);
        expect(validatePath('file.txt', workingDir).valid).toBe(true);
        expect(validatePath('./src/file.txt', workingDir).valid).toBe(true);
    });

    it('should reject paths outside working directory', () => {
        const result = validatePath('/etc/passwd', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should prevent path traversal attacks', () => {
        const result = validatePath('../../.ssh/id_rsa', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should allow the working directory itself', () => {
        expect(validatePath('.', workingDir).valid).toBe(true);
        expect(validatePath(workingDir, workingDir).valid).toBe(true);
    });

    describe('root working directory', () => {
        it('should allow any absolute path when workingDirectory is /', () => {
            expect(validatePath('/vol1', '/').valid).toBe(true);
            expect(validatePath('/vol1/1000/project', '/').valid).toBe(true);
            expect(validatePath('/home/user/project', '/').valid).toBe(true);
            expect(validatePath('/etc/passwd', '/').valid).toBe(true);
        });

        it('should allow root itself', () => {
            expect(validatePath('/', '/').valid).toBe(true);
            expect(validatePath('.', '/').valid).toBe(true);
        });
    });
});
