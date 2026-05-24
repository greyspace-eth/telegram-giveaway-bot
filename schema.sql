CREATE DATABASE IF NOT EXISTS telegram_bot;

USE telegram_bot;

CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    telegram_id VARCHAR(255) UNIQUE NOT NULL,
    telegram_username VARCHAR(255) NOT NULL
);

CREATE TABLE socials (
    user_id INT,
    twitter_connected BOOLEAN DEFAULT FALSE,
    twitter_id VARCHAR(255),
    twitter_handle VARCHAR(255),
    twitter_access_token VARCHAR(255),
    twitter_access_secret VARCHAR(255),
    discord_connected BOOLEAN DEFAULT FALSE,
    discord_id VARCHAR(255),
    discord_username VARCHAR(255),
    discord_access_token VARCHAR(255),
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE giveaways (
    giveaway_id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(255) UNIQUE,
    prize VARCHAR(255),
    min_followers INT,
    max_participants INT,
    post_link VARCHAR(255),
    num_winners INT,
    close_date DATETIME,
    isEnded BOOLEAN DEFAULT FALSE,
    creator_id INT,
    FOREIGN KEY (creator_id) REFERENCES users(user_id)
);

CREATE TABLE participants (
    user_id INT,
    giveaway_id INT,
    isWinner BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (user_id, giveaway_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (giveaway_id) REFERENCES giveaways(giveaway_id)
);

