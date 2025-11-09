FROM php:8.4-apache-bullseye

RUN apt-get update && apt-get install -y git zip unzip

COPY --from=composer:2.8.12 /usr/bin/composer /usr/bin/composer

WORKDIR /app
