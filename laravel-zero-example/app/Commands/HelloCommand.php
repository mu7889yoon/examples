<?php

namespace App\Commands;

use Illuminate\Console\Scheduling\Schedule;
use LaravelZero\Framework\Commands\Command;

class HelloCommand extends Command
{
    /**
     * The signature of the command.
     *
     * @var string
     */
    protected $signature = 'hello';

    /**
     * The description of the command.
     *
     * @var string
     */
    protected $description = 'Display hello message';

    /**
     * Execute the console command.
     */
    public function handle(): void
    {
        $this->info('hello');
    }

    /**
     * Define the command's schedule.
     */
    public function schedule(Schedule $schedule): void
    {
        // $schedule->command(static::class)->everyMinute();
    }
}

