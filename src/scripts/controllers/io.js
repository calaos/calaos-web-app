'use strict';

angular.module('calaosApp')
.controller('LightDimmerCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

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
.controller('LightRGBCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {


}]);
