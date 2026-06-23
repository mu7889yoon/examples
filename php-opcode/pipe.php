<?php

$title = ' PHP 8.5 Released ';
$slug = $title
    |> trim(...)
    |> (fn (string $value) => str_replace(' ', '-', $value))
    |> strtolower(...);
echo($slug);
