<?php

namespace Tests\Cloud\E2E\General;

use PHPUnit\Framework\Attributes\Depends;

class UsageTest
{
    public function testPrepareStorageUsage(): array
    {
        return ['bucketId' => 'x'];
    }

    #[Depends('testPrepareStorageUsage')]
    public function testGaugesResourceTypeDimension(): void
    {
        // Fails without its dependency in the retry --filter.
    }
}
