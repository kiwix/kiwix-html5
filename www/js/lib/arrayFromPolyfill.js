/**
 * Simple Array.from polyfi8ll (with Set support) from https://stackoverflow.com/a/62682524/9727685
 */
(function () {
	// Detection
	if ('from' in Array) return;

	function arrayFrom(arr, callbackFn, thisArg) {
		//if you need you can uncomment the following line
		//if(!arr || typeof arr == 'function')throw new Error('This function requires an array-like object - not null, undefined or a function');

		var arNew = [],
			k = [], // used for convert Set to an Array
			i = 0;

		//if you do not need a Set object support then
		//you can comment or delete the following if statement
		if (window.Set && arr instanceof Set) {
			//we use forEach from Set object
			arr.forEach(function (v) {
				k.push(v)
			});
			arr = k;
		}

		for (; i < arr.length; i++)
			arNew[i] = callbackFn ?
			callbackFn.call(thisArg, arr[i], i, arr) :
			arr[i];

		return arNew;
	}
	//You could also use it without the following line, but it is not recommended because native function is faster.
	Array.from = arrayFrom; //We set it as polyfill
}());