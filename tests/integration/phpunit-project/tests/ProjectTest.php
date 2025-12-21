<?php

namespace Tests;

use PHPUnit\Framework\TestCase;

class ProjectTest extends TestCase
{
    public function testCreateProject(): array
    {
        $this->assertTrue(true);
        return ['projectId' => 'abc123'];
    }

    /**
     * @depends testCreateProject
     */
    public function testListProjects(array $data): array
    {
        $this->assertEquals('abc123', $data['projectId']);
        return $data;
    }

    /**
     * @depends testCreateProject
     */
    public function testUpdateProject(array $data): array
    {
        $this->assertEquals('abc123', $data['projectId']);
        return array_merge($data, ['name' => 'Updated Project']);
    }

    /**
     * @depends testUpdateProject
     */
    public function testDeleteProject(array $data): void
    {
        // This will fail on first run
        static $runCount = 0;
        $runCount++;

        if ($runCount < 2) {
            $this->fail('Simulated flaky test failure');
        }

        $this->assertEquals('Updated Project', $data['name']);
    }

    public function testProjectValidation(): void
    {
        $this->assertTrue(true);
    }
}
