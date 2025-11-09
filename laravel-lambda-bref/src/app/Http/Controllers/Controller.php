<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response as HttpResponse;
use Illuminate\Support\Facades\Response;

class Controller
{
    public function index(): HttpResponse {
        return Response::view('index');
    }
}
