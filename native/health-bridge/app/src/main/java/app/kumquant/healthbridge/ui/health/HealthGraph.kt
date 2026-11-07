package app.kumquant.healthbridge.ui.health

import android.net.Uri
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import app.kumquant.healthbridge.ui.exercises.ExercisesScreen

const val HEALTH_ROUTE = "health"

/** The Exercises tab: live card plus workout history. */
const val EXERCISES_ROUTE = "exercises"

/** Route names of every health screen. */
object Routes {
    const val HR = "health/hr"
    const val SLEEP = "health/sleep"
    const val STEPS = "health/steps"
    const val KCAL = "health/calories"
    const val DISTANCE = "health/distance"
    const val SPO2 = "health/spo2"
    const val STRESS = "health/stress"
    const val ENERGY = "health/energy"
    const val RESTING = "health/resting"
    const val BODY = "health/body"
    /** The Health home's Workout tile opens the Exercises tab. */
    const val WORKOUTS = EXERCISES_ROUTE
    const val WORKOUT = "health/workout/{id}"
    fun workout(id: String) = "health/workout/${Uri.encode(id)}"
}

/** Registers the tile home at [HEALTH_ROUTE] and every detail screen. */
fun NavGraphBuilder.healthGraph(nav: NavHostController) {
    val back: () -> Unit = { nav.popBackStack() }
    composable(HEALTH_ROUTE) {
        HealthHome(onOpen = { route -> nav.navigate(route) })
    }
    composable(Routes.HR) { HrScreen(back) }
    composable(Routes.SLEEP) { SleepScreen(back) }
    composable(Routes.STEPS) { AccumulatorScreen(StepsAcc, back) }
    composable(Routes.KCAL) { AccumulatorScreen(KcalAcc, back) }
    composable(Routes.DISTANCE) { AccumulatorScreen(DistanceAcc, back) }
    composable(Routes.SPO2) { VitalScreen(Spo2Vital, back) }
    composable(Routes.STRESS) { VitalScreen(StressVital, back) }
    composable(Routes.ENERGY) { VitalScreen(EnergyVital, back) }
    composable(Routes.RESTING) { RestingScreen(back) }
    composable(Routes.BODY) { BodyScreen(back) }
    composable(EXERCISES_ROUTE) { ExercisesScreen { id -> nav.navigate(Routes.workout(id)) } }
    composable(Routes.WORKOUT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
        WorkoutDetailScreen(e.arguments?.getString("id").orEmpty(), back)
    }
}
