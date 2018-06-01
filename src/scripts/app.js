'use strict';

angular
    .module('calaosApp', [
        'ngSanitize',
        'ui.router',
        'ngDialog',
        'farbtastic'
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
                url: '/{cameraId:int}',
                templateUrl: 'views/camera.html',
            });
    })
    .run(function($rootScope, $location, $timeout, CalaosApp, $transitions) {

        //Here we capture state changes (using Transition Hooks https://ui-router.github.io/guide/transitionhooks)
        //and inspect the wanted state for requireLogin property. If we try to access a page
        //which the user does not have access to (not login yet), we redirect to login state

        const criteriaObj = {
            to: (state) => !!state.data.requireLogin
        }

        $transitions.onStart(criteriaObj, function(transition) {
            console.log("checking login state");
            if (!CalaosApp.isAuth()) {
                console.log("not logged in, redirect");
                return transition.router.stateService.target('login');
            }
        })
    })
    .config(function($sceDelegateProvider) {
        $sceDelegateProvider.resourceUrlWhitelist([
            // Allow same origin resource loads.
            'self',

            // Allow loading from dev calaos_server 5454 port.
            'http://127.0.0.1:5454/**'
        ]);
    });
