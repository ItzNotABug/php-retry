<?php

namespace Tests;

use PHPUnit\Framework\TestCase;

class SampleTest extends TestCase
{
    public function testCreate(): array
    {
        $this->assertTrue(true);
        return ['id' => 123];
    }

    /**
     * @depends testCreate
     */
    public function testUpdate(array $data): array
    {
        $this->assertEquals(123, $data['id']);
        return array_merge($data, ['updated' => true]);
    }

    /**
     * @depends testUpdate
     */
    public function testDelete(array $data): void
    {
        // This will fail
        $this->assertEquals(999, $data['id'], 'Expected ID to be 999');
    }

    /**
     * @depends testCreate
     */
    public function testRead(array $data): array
    {
        $this->assertEquals(123, $data['id']);
        return $data;
    }

    /**
     * @depends testCreate
     * @depends testRead
     */
    public function testMultipleDeps(array $create, array $read): void
    {
        // This will fail
        $this->assertEquals(456, $create['id'], 'Expected ID to be 456');
    }

    public function testIndependent(): void
    {
        $this->assertTrue(true);
    }

    public function testAnotherFailure(): void
    {
        // This will fail with an error
        throw new \Exception('Division by zero');
    }
}
