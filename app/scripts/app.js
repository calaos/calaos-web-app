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
                url: '/login',
                templateUrl: 'views/login.html',
                data: {
                    requireLogin: false
                }
            })
            .state('home', {
                url: '/home',
                templateUrl: 'views/home.html',
                data: {
                    requireLogin: true
                }
            })
            .state('home.rooms', {
                url: '/rooms',
                templateUrl: 'views/home.html',
                data: {
                    requireLogin: true
                }
            })
            .state('home.rooms.detail', {
                url: '/:roomid',
                templateUrl: 'views/home.html',
                data: {
                    requireLogin: true
                }
            });
    })
    .run(function($rootScope, $location, $timeout) {

        //Here we capture state changes (from defined states in $stateProvider)
        //and inspect them for requireLogin property. If we try to access a page
        //wich the user does not have access (not login yet), we redirect to /login

        //subsrcibe to state change events
        $rootScope.$on('$stateChangeStart', function (event, toState, toParams) {

            var requireLogin = toState.data.requireLogin;

            if (requireLogin &&
                (typeof $rootScope.isAuth === 'undefined' ||
                 $rootScope.isAuth === false)) {

                //using $state.go('login') here make a digest loop in angular...
                $location.path('/login');
            }
        });
    });
