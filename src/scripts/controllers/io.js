'use strict';

angular.module('calaosApp')
.controller('LightDimmerCtrl', ['$scope', 'CalaosApp', function ($scope, CalaosApp) {

    var updateState = function (item) {
        $scope.percent_value = 0.0;
        $scope.bool_status = false;

        if (!isNaN(parseInt(item.state)))
            $scope.percent_value = parseInt(item.state);
        else if (item.state.substr(0, 4) == "set ")
            $scope.percent_value = parseInt(item.state.substr(4, item.state.length - 4));
        else if (item.state == "true")
            $scope.percent_value = 100;
        else if (item.state == "false")
            $scope.percent_value = 0;

        $scope.bool_status = $scope.percent_value > 0?true:false;
        $scope.percent_value_rw = $scope.percent_value;
    }

    $scope.changeValueDimmer = function (item) {
        var s = "set " + $scope.percent_value_rw;
        CalaosApp.setState(item, s);
    }

    updateState($scope.item);
    $scope.$watch("item", function() {
        updateState($scope.item);
    }, true);

}]);

angular.module('calaosApp')
.controller('LightRGBCtrl', ['$scope', 'CalaosApp', 'ngDialog', '$rootScope', function ($scope, CalaosApp, ngDialog, $rootScope) {

    var updateState = function (item) {
        $scope.color = item.state == '0'?'#000':item.state;
        console.log("updateState color: " + $scope.color);
        $scope.bool_status = item.state == '0' || item.state == '#000000'?false:true;
    }

    $scope.colorPicker = function() {
        console.log("ColorPicker click");

        ngDialog.open({
			template: 'views/color-picker.html',
			controller: 'ColorPickerCtrl',
			className: 'ngdialog-theme-default',
			closeByDocument: false,
            scope: $scope
        });
    };

    updateState($scope.item);
    $scope.$watch("item", function() {
        updateState($scope.item);
    }, true);

}]);

angular.module('calaosApp')
.controller('ColorPickerCtrl', ['$scope', 'CalaosApp', 'ngDialog', function ($scope, CalaosApp, ngDialog) {

    console.log("currentColor: " + $scope.color)

    $scope.close = function() {
       ngDialog.close();
    }

    $scope.validColor = function() {
        console.log("Valid color clicked");
        ngDialog.close();

        CalaosApp.setState($scope.item, "set " + $scope.color);
    }

}]);

angular.module('calaosApp')
.controller('VarStringCtrl', ['$scope', 'CalaosApp', 'ngDialog', '$rootScope', function ($scope, CalaosApp, ngDialog, $rootScope) {

    var updateState = function (item) {
        console.log(item);
        $scope.display_text = item.state == ''?item.name:item.state;
        $scope.text = item.state;
    }

    $scope.dialogText = function() {
        ngDialog.open({
			template: 'views/dialog-text.html',
			controller: 'StringDialogCtrl',
			className: 'ngdialog-theme-default',
			closeByDocument: false,
            scope: $scope
        });
    };

    updateState($scope.item);
    $scope.$watch("item", function() {
        updateState($scope.item);
    }, true);

}]);

angular.module('calaosApp')
.controller('StringDialogCtrl', ['$scope', 'CalaosApp', 'ngDialog', function ($scope, CalaosApp, ngDialog) {

    $scope.close = function() {
       ngDialog.close();
    }

    $scope.validText = function() {
        ngDialog.close();
        CalaosApp.setState($scope.item, $scope.text);
    }

}]);
