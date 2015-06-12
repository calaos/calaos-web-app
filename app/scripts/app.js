'use strict';

angular
    .module('calaosApp', [
        'ngAnimate',
        'ngAria',
        'ngCookies',
        'ngMessages',
        'ngResource',
        'ngRoute',
        'ngSanitize',
        'ngTouch',
        'mgcrea.ngStrap',
    ])
    .config(function ($stateProvider) {
        $stateProvider
            .state('login', {
                url: '/login',
                data: {
                    requireLogin: false
                }
            })
            .state('home', {
                abstract: true,
                data: {
                    requireLogin: true
                }
            });
  });
