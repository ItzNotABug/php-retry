<?php

namespace Tests\E2E\Services\Sample;

class SampleTest
{
    public function testCreate(): array
    {
        return ['id' => 123];
    }

    /**
     * @depends testCreate
     */
    public function testUpdate(array $data): array
    {
        return array_merge($data, ['updated' => true]);
    }

    /**
     * @depends testUpdate
     */
    public function testDelete(array $data): void
    {
        // Delete logic
    }

    /**
     * @depends testCreate
     */
    public function testRead(array $data): void
    {
        // Read logic
    }

    /**
     * @depends testCreate
     * @depends testRead
     */
    public function testMultipleDeps(array $create, array $read): void
    {
        // Multiple dependencies
    }

    public function testIndependent(): void
    {
        // No dependencies
    }
}
