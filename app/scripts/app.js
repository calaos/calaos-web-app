'use strict';

angular
    .module('calaosApp', [
        'ngAnimate',
        'ngAria',
        'ngCookies',
        'ngMessages',
        'ngResource',
        'ngSanitize',
        'ngTouch',
        'mgcrea.ngStrap',
        'ui.router',
    ])
    .config(function ($stateProvider, $urlRouterProvider) {

        //For any unmatched url, redirect to /home
        $urlRouterProvider.otherwise('/home');

        //Set up the states
        $stateProvider
            .state('login', {
                templateUrl: 'views/login.html',
                data: {
                    requireLogin: false
                }
            })
            .state('home', {
                templateUrl: 'views/home.html',
                data: {
                    requireLogin: true
                }
            })
            .state('home.rooms', {
                templateUrl: 'views/home.html',
                data: {
                    requireLogin: true
                }
            });
  });
