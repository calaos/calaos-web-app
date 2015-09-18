'use strict';

angular
    .module('calaosApp', [
        'ngSanitize',
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
                abstract: true,
                url: '/home',
                template: '<div ui-view class="fade"></div>',
                data: {
                    requireLogin: true
                }
            })
            .state('home.list', {
                url: '',
                templateUrl: 'views/home.html',
            })
            .state('home.room', {
                url: '/{roomId:int}',
                templateUrl: 'views/room.html',
                controller: 'RoomCtrl',
            })
            .state('audio', {
                abstract: true,
                url: '/audio',
                template: '<div ui-view class="fade"></div>',
                data: {
                    requireLogin: true
                }
            })
            .state('audio.list', {
                url: '',
                templateUrl: 'views/audiolist.html',
            })
            .state('audio.player', {
                url: '/{playerId}',
                templateUrl: 'views/audio_player.html',
            })
            .state('security', {
                abstract: true,
                url: '/security',
                template: '<div ui-view class="fade"></div>',
                data: {
                    requireLogin: true
                }
            })
            .state('security.list', {
                url: '',
                templateUrl: 'views/cameralist.html',
            })
            .state('security.camera', {
                url: '/{cameraId}',
                templateUrl: 'views/camera.html',
            });
    })
    .run(function($rootScope, $location, $timeout, CalaosApp, $state) {

        $rootScope.$state = $state;

        //Here we capture state changes (from defined states in $stateProvider)
        //and inspect them for requireLogin property. If we try to access a page
        //wich the user does not have access (not login yet), we redirect to /login

        //subsrcibe to state change events
        $rootScope.$on('$stateChangeStart', function (event, toState, toParams) {

            var requireLogin = toState.data.requireLogin;

            if (requireLogin && !CalaosApp.isAuth()) {

                console.log("not logged in, redirect");

                //using $state.go('login') here make a digest loop in angular...
                $location.path('/login');
            }
        });
    });
