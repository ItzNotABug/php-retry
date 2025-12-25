FROM php:8.2-alpine

RUN apk add --no-cache unzip

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app

COPY composer.json ./

RUN composer install --no-interaction --no-progress

COPY . .

CMD ["vendor/bin/phpunit", "--log-junit", "/tmp/junit.xml"]
