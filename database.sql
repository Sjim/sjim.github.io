-- init
DROP DATABASE IF EXISTS User;

CREATE DATABASE User;

USE User;

create table if NOT exists USERINFO(
    id INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY ,
    username VARCHAR(32) NOT  NULL ,
    password VARCHAR(96) NOT NULL ,
    salt VARCHAR(96) NOT NULL 
)ENGINE=InnoDB DEFAULT CHARSET=utf8;